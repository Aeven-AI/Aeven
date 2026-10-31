/** Setup route, archive reuse, decompiler build, and agent-scoped MCP connection for the private analysis runtime. */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Tools from '@aeven/tools'
import SystemPrompt from '@aeven/system-prompt'
import LocalSubprocess from '@aeven/subprocess-local'
import type { Agent } from '@aeven/agent'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReverseEngineeringRuntime, type ReverseEngineeringConfig } from '../src/reverse-engineering.ts'
import AccountIntegrations, { type Config } from '../src/index.ts'

const disposers: (() => Promise<void>)[] = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

/** Versions and budgets one fixture runtime is built with. */
function config(overrides: Partial<ReverseEngineeringConfig> = {}): ReverseEngineeringConfig {
  return { reaVersion: '6.7.0', ghidraRelease: 'Ghidra_12.1.4_build', javaVersion: 21,
    timeoutMs: 30_000, retryDelayMs: 600_000, stopGraceMs: 1_000, outputMaxBytes: 65_536, ...overrides }
}

/** Decompiler directory Ghidra expects on the host running this spec. */
const osDirectory = `${({ darwin: 'mac', linux: 'linux', win32: 'win' } as Record<string, string>)[process.platform]!}_${({ arm64: 'arm_64', x64: 'x86_64' } as Record<string, string>)[process.arch]!}`

async function fixture(options: { corrupt?: boolean; unhealthy?: boolean; host?: boolean; build?: boolean; seedCache?: boolean } = {}) {
  const { corrupt = false, unhealthy = false, host = false, build = false, seedCache = false } = options
  const directory = await mkdtemp(join(tmpdir(), 'avn-rea-install-'))
  disposers.push(() => rm(directory, { recursive: true, force: true }))
  vi.stubEnv('AVN_HOME', directory)
  // A runner image often exports a JDK or Ghidra location of its own. Both the
  // host probe and the engine checks read these names, so a spec that wants the
  // fixture's engines has to start from a host that names none.
  for (const name of ['GHIDRA_INSTALL_DIR', 'JAVA_HOME', 'JDK_HOME']) vi.stubEnv(name, undefined)
  const javaPath = process.platform === 'darwin' ? 'jdk/Contents/Home/bin' : 'jdk/bin'
  await mkdir(join(directory, javaPath), { recursive: true })
  await writeFile(join(directory, javaPath, 'java'), 'fixture JDK')
  const javaArchive = process.platform === 'win32'
    ? zipSync({ 'jdk/bin/java': new TextEncoder().encode('fixture JDK') })
    : (execFileSync('tar', ['-czf', join(directory, 'java.tar.gz'), '-C', directory, 'jdk']), await readFile(join(directory, 'java.tar.gz')))
  // A release archive without this platform's decompiler, as the official macOS zip is, unless the fixture ships one.
  const ghidraArchive = zipSync({
    'ghidra/Ghidra/application.properties': new TextEncoder().encode('fixture Ghidra'),
    // The build needs its working directory to exist; the decompiler source is what Ghidra's archive carries.
    'ghidra/Ghidra/Features/Decompiler/src/decompile/cpp/Makefile': new TextEncoder().encode('fixture Makefile'),
    ...(build ? {} : { [`ghidra/Ghidra/Features/Decompiler/os/${osDirectory}/decompile`]: new TextEncoder().encode('fixture decompiler') }),
  })
  const hostRoot = join(directory, 'host-engine')
  const hostGhidra = host ? join(hostRoot, 'ghidra') : null
  const hostJava = host ? join(hostRoot, 'java') : null
  if (host) {
    await mkdir(join(hostGhidra!, 'Ghidra'), { recursive: true })
    await writeFile(join(hostGhidra!, 'Ghidra', 'application.properties'), 'fixture host Ghidra')
    await mkdir(join(hostJava!, 'bin'), { recursive: true })
    await writeFile(join(hostJava!, 'bin', 'java'), 'fixture host JDK')
  }
  const checksum = (data: Uint8Array) => createHash('sha256').update(data).digest('hex')
  if (seedCache) {
    const archives = join(directory, 'runtimes', 'reverse-engineering', 'archives')
    await mkdir(archives, { recursive: true })
    await writeFile(join(archives, `${checksum(ghidraArchive)}.zip`), ghidraArchive)
    await writeFile(join(archives, `${checksum(javaArchive)}.tar.gz`), javaArchive)
  }
  const downloads: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    downloads.push(url)
    if (url.startsWith('https://api.github.com/')) return Response.json({ assets: [{ name: 'ghidra_12.1.4_PUBLIC_20260921.zip',
      browser_download_url: 'https://fixtures.test/ghidra', digest: `sha256:${corrupt ? '0'.repeat(64) : checksum(ghidraArchive)}` }] })
    if (url.startsWith('https://api.adoptium.net/')) return Response.json([{ binary: { package: { link: 'https://fixtures.test/java', checksum: checksum(javaArchive) } } }])
    if (url === 'https://fixtures.test/ghidra') return new Response(ghidraArchive)
    if (url === 'https://fixtures.test/java') return new Response(javaArchive)
    throw new Error(`unexpected fetch: ${url}`)
  }))
  const require = createRequire(import.meta.url)
  const serverModule = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/mcp.js')).href
  const transportModule = pathToFileURL(require.resolve('@modelcontextprotocol/sdk/server/stdio.js')).href
  const server = `
import { existsSync } from 'node:fs';
if (process.argv[2] === 'doctor') {
  // A doctor run without an engine in its environment probes the host and names what it found in the report.
  const hostGhidra = ${JSON.stringify(hostGhidra)};
  const hostJava = ${JSON.stringify(hostJava)};
  const ghidra = process.env.GHIDRA_INSTALL_DIR ?? hostGhidra;
  const javaHome = process.env.JAVA_HOME ?? hostJava;
  const ready = ${unhealthy ? 'false' : "ghidra !== null && javaHome !== null && existsSync(ghidra + '/Ghidra/application.properties') && existsSync(javaHome + '/bin/java')"};
  // A real doctor exits non-zero for informational checks this integration never satisfies: optional engines,
  // client MCP registrations, and its own skill copy. The provider inspection is what readiness means.
  console.log(JSON.stringify({
    providerInspections: [{ id: 'ghidra', available: ready,
      registrationEnvironment: { GHIDRA_INSTALL_DIR: ghidra, JAVA_HOME: javaHome },
      checks: [
        { name: 'installation', ok: true, detail: null },
        { name: 'native_decompiler', ok: ready, detail: ready ? null : 'Matching native decompiler was not found' },
      ] }],
    checks: [{ name: 'registration:codex', ok: false, detail: '/fixture/config.toml' }],
  }));
  process.exitCode = 1;
} else {
  const { McpServer } = await import(${JSON.stringify(serverModule)});
  const { StdioServerTransport } = await import(${JSON.stringify(transportModule)});
  const server = new McpServer({ name: 'fixture-rea', version: '6.7.0' });
  server.registerTool('open_binary', { inputSchema: {} }, async () => ({ content: [{ type: 'text', text: String(process.env.GHIDRA_INSTALL_DIR) }] }));
  await server.connect(new StdioServerTransport());
}
`
  const ctx = new Context()
  disposers.push(() => ctx.fiber.dispose())
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.builtins.systemPrompt = SystemPrompt
  ctx.loader.builtins.tools = Tools
  ctx.loader.builtins.subprocess = LocalSubprocess
  await writeFile(join(directory, 'cordis.yml'), '- id: system-prompt\n  name: cordis:systemPrompt\n- id: tools\n  name: cordis:tools\n- id: subprocess\n  name: cordis:subprocess\n')
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(join(directory, 'cordis.yml')).href } })
  await ctx.loader.await()
  const spawn = ctx.subprocess.spawn.bind(ctx.subprocess)
  const npmProgram = `const fs = require('node:fs'); fs.mkdirSync('node_modules/rea-agents/scripts', { recursive: true }); fs.writeFileSync('node_modules/rea-agents/package.json', '{"version":"6.7.0"}'); fs.writeFileSync('node_modules/rea-agents/scripts/rea.mjs', ${JSON.stringify(server)});`
  const built: (readonly string[])[] = []
  const npm = vi.spyOn(ctx.subprocess, 'spawn').mockImplementation((spec) => {
    if (spec.argv[0] === 'npm' || spec.argv[0] === 'npm.cmd') return spawn({ ...spec, argv: [process.execPath, '-e', npmProgram] })
    if (spec.argv[0] === 'make' || spec.argv[0] === 'bison') {
      built.push(spec.argv)
      const program = spec.argv.includes('ghidra_opt')
        ? "require('node:fs').writeFileSync('ghidra_opt', 'fixture decompiler build')"
        : 'console.log("fixture toolchain")'
      return spawn({ ...spec, argv: [process.execPath, '-e', program] })
    }
    return spawn(spec)
  })
  const runtime = new ReverseEngineeringRuntime(ctx, config())
  function agent(): Agent {
    const agentCtx = new Context()
    disposers.push(() => agentCtx.fiber.dispose())
    // This helper only borrows the Agent's disposal context and scope identity.
    return { ctx: agentCtx } as Agent
  }
  return { directory, ctx, runtime, downloads, npm, built, agent }
}

describe('reverse-engineering first request', () => {
  it('resolves complete versions when an existing profile replaces account configuration', () => {
    // A profile document names only some keys; the schema supplies the rest, including the REA defaults.
    const config = AccountIntegrations.Config({ apiUrl: 'http://localhost:9000' } as unknown as Config)
    expect(config.reverseEngineering).toMatchObject({ reaVersion: '6.7.0', ghidraRelease: 'Ghidra_12.1.4_build', javaVersion: 21 })
  })

  it('downloads only on demand, shares installation, scopes tools, reuses disk, and disposes tools', async () => {
    const { ctx, runtime, downloads, directory, agent, npm } = await fixture()
    expect(downloads).toEqual([])
    const first = agent()
    await Promise.all([runtime.prepare(first), runtime.prepare(first)])
    expect(ctx.get('tools')!.get('mcp__rea__open_binary')).toBeUndefined()
    expect(ctx.get('tools')!.get('mcp__rea__open_binary', first)).toBeDefined()
    const second = agent()
    expect(ctx.get('tools')!.get('mcp__rea__open_binary', second)).toBeUndefined()
    await runtime.prepare(second)
    expect(downloads).toHaveLength(4)
    expect(npm.mock.calls.filter(([spec]) => spec.argv[0] === 'npm' || spec.argv[0] === 'npm.cmd')).toHaveLength(1)
    const fresh = new ReverseEngineeringRuntime(ctx, config())
    await fresh.prepare(agent())
    expect(downloads).toHaveLength(4)
    expect((await readdir(join(directory, 'runtimes', 'reverse-engineering'))).sort())
      .toEqual(['6.7.0-Ghidra_12.1.4_build-jdk21-' + process.platform + '-' + process.arch, 'archives'])
    await first.ctx.fiber.dispose()
    expect(ctx.get('tools')!.get('mcp__rea__open_binary', first)).toBeUndefined()
    expect(ctx.get('tools')!.get('mcp__rea__open_binary', second)).toBeDefined()
  })

  it('mounts a host Ghidra and JDK that certify, without downloading an engine', async () => {
    const { ctx, runtime, downloads, directory, agent, built } = await fixture({ host: true })
    const owner = agent()
    await runtime.prepare(owner)
    // The host already provides Ghidra and the JDK: nothing is fetched and nothing is built.
    expect(downloads).toEqual([])
    expect(built).toEqual([])
    const tools = ctx.get('tools')!.get('mcp__rea__open_binary', owner)!
    const result = await tools.execute?.({}, { signal: new AbortController().signal } as never) as { content: { text: string }[] }
    expect(result.content[0]!.text).toBe(join(directory, 'host-engine', 'ghidra'))
    const root = join(directory, 'runtimes', 'reverse-engineering', '6.7.0-Ghidra_12.1.4_build-jdk21-' + process.platform + '-' + process.arch)
    expect(JSON.parse(await readFile(join(root, 'ready.json'), 'utf8'))).toEqual({
      ghidra: join(directory, 'host-engine', 'ghidra'), javaHome: join(directory, 'host-engine', 'java'),
    })
  })

  it('reuses archives a previous attempt already downloaded', async () => {
    const { runtime, downloads, agent } = await fixture({ seedCache: true })
    await runtime.prepare(agent())
    expect(downloads.filter(url => url.startsWith('https://fixtures.test/'))).toEqual([])
    expect(downloads).toHaveLength(2)
  })

  it.skipIf(process.platform !== 'darwin')('builds the decompiler the macOS archive omits', async () => {
    const { runtime, built, directory, agent } = await fixture({ build: true })
    await runtime.prepare(agent())
    expect(built.find(argv => argv.includes('ghidra_opt'))).toEqual(['make', 'ghidra_opt', `ARCH_TYPE=-arch ${process.arch}`, `OSDIR=${osDirectory}`, '-j4'])
    const root = join(directory, 'runtimes', 'reverse-engineering', '6.7.0-Ghidra_12.1.4_build-jdk21-' + process.platform + '-' + process.arch)
    expect(await readFile(join(root, 'ghidra', 'Ghidra', 'Features', 'Decompiler', 'os', osDirectory, 'decompile'), 'utf8'))
      .toBe('fixture decompiler build')
  })

  it('rejects a corrupt download before MCP registration and leaves no partial archive', async () => {
    const { ctx, runtime, directory, agent, npm } = await fixture({ corrupt: true })
    const owner = agent()
    await expect(runtime.prepare(owner)).rejects.toThrow('checksum mismatch')
    expect(npm).toHaveBeenCalled()
    expect(ctx.get('tools')!.get('mcp__rea__open_binary', owner)).toBeUndefined()
    expect(await readdir(join(directory, 'runtimes', 'reverse-engineering'))).toEqual(['archives'])
    expect(await readdir(join(directory, 'runtimes', 'reverse-engineering', 'archives'))).toEqual([])
  })

  it('reports the failing provider checks when the doctor cannot certify ghidra', async () => {
    const { runtime, agent } = await fixture({ unhealthy: true })
    await expect(runtime.prepare(agent())).rejects.toThrow('did not certify ghidra: native_decompiler: Matching native decompiler was not found')
  })

  it('installs when the skill is enabled, so the first request already has the tools', async () => {
    const { ctx, runtime, downloads, agent } = await fixture()
    // The activation path: no agent and no request, just the enabled skill.
    runtime.warm()
    await vi.waitFor(() => { expect(downloads).toHaveLength(4) })
    const owner = agent()
    await runtime.prepare(owner)
    expect(ctx.get('tools')!.get('mcp__rea__open_binary', owner)).toBeDefined()
    expect(downloads).toHaveLength(4)
  })

  it('never makes a request wait for or fail with setup, and retries only after the delay', async () => {
    const { ctx, runtime, downloads, agent } = await fixture({ corrupt: true })
    const warnings: string[] = []
    ctx.logger.exporter({ levels: { default: 3 }, export: (message) => { warnings.push(message.args.join(' ')) } })
    const owner = agent()
    // `start` is the pre-step entry point: it returns at once and the install continues in the background.
    expect(() => { runtime.start(owner) }).not.toThrow()
    await vi.waitFor(() => { expect(warnings.some(line => line.includes('checksum mismatch'))).toBe(true) })
    expect(downloads).toHaveLength(3)
    // The failure is remembered for retryDelayMs, so neither a request nor an activation starts another download.
    runtime.start(owner)
    runtime.warm()
    await new Promise((resolve) => { setTimeout(resolve, 50) })
    expect(downloads).toHaveLength(3)
    expect(warnings.filter(line => line.includes('reverse-engineering prepare failed'))).toHaveLength(1)
  })
})
