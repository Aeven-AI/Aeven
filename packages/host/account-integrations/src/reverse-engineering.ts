/** Private, first-use REA/Ghidra installation and agent-scoped MCP ownership. */
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { delimiter, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import { avnHomePath } from '@aeven/home-paths'
import { createScope } from '@aeven/scope'
import * as mcp from '@aeven/mcp-client'
import type {} from '@aeven/subprocess'
import { z } from 'zod'

/** Versions and process budgets for the deployment's private analysis runtime. */
export interface ReverseEngineeringConfig {
  /** `rea-agents` version installed into the private runtime. */
  reaVersion: string
  /** Ghidra release tag whose archive is downloaded from the project's GitHub releases. */
  ghidraRelease: string
  /** Adoptium JDK feature version the runtime is built against. */
  javaVersion: number
  /** Budget for the whole setup: both downloads, extraction, the npm install, and the doctor run. */
  timeoutMs: number
  /** Wait after a failed setup before a later request may start another one; zero retries on every request. */
  retryDelayMs: number
  /** Time a stopping REA child gets to exit cleanly before it is killed. */
  stopGraceMs: number
  /** Largest stdout or stderr the runtime captures from one child process. */
  outputMaxBytes: number
}

const archiveSchema = z.object({ link: z.url(), checksum: z.string().regex(/^[a-f0-9]{64}$/) })
const releaseSchema = z.object({ assets: z.array(z.object({
  name: z.string(), browser_download_url: z.url(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})) })
const javaSchema = z.array(z.object({ binary: z.object({ package: archiveSchema }) })).min(1)
/** Readiness the doctor reports per analysis provider; its own scope and not the process exit status is authoritative. */
const doctorSchema = z.object({ providerInspections: z.array(z.object({
  id: z.string(),
  available: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullish() })).default([]),
})) })

/**
 * Prepare an installed account skill's native analysis tools without changing host software.
 * Downloads are shared by agents; MCP tools belong only to each requesting agent.
 */
export class ReverseEngineeringRuntime {
  private readonly lifecycle = new AbortController()
  private installation: Promise<string> | undefined
  private readonly mounts = new WeakMap<Agent, Promise<void>>()
  /** When the last setup failed, so later requests do not repeat a multi-minute download. */
  private failedAt: number | undefined

  /** @param ctx - owning Host context; disposal cancels and drains installation. @param config - validated versions and budgets. */
  constructor(private readonly ctx: Context, private readonly config: ReverseEngineeringConfig) {
    ctx.effect(() => async () => {
      this.lifecycle.abort(new Error('reverse-engineering runtime disposed'))
      await this.installation?.catch(() => undefined)
    }, 'account-integrations: reverse-engineering installation')
  }

  /**
   * Begin preparing REA for an agent without waiting for it.
   *
   * A model request never depends on the download: the tools appear for later requests once they are connected, and
   * a failed setup is logged and retried only after `retryDelayMs`, never as a rejection the turn has to survive.
   * @param agent - authenticated agent whose account enabled the skill.
   */
  start(agent: Agent): void {
    if (this.failedAt !== undefined && Date.now() - this.failedAt < this.config.retryDelayMs) return
    void this.prepare(agent).catch((error: unknown) => {
      this.failedAt = Date.now()
      this.ctx.logger('account-integrations').warn(`reverse-engineering setup failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  /**
   * Install once and connect REA after the enabled account's first request that needed it.
   *
   * The caller's `signal` stops waiting for this caller only; the shared installation keeps running for other agents
   * and for later requests.
   * @param agent - authenticated agent whose account enabled the skill.
   * @param signal - cancellation for this caller's wait.
   * @returns readiness after installation and MCP discovery; failures reject the wait.
   */
  async prepare(agent: Agent, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    let ready = this.mounts.get(agent)
    if (ready === undefined) {
      const scope = createScope(this.ctx, agent)
      const controller = new AbortController()
      agent.ctx.effect(() => async () => {
        controller.abort(new Error('reverse-engineering agent disposed'))
        await ready?.catch(() => undefined)
        await scope.dispose()
        this.mounts.delete(agent)
      }, 'account-integrations: reverse-engineering MCP')
      ready = (async () => {
        this.installation ??= this.install().catch((error: unknown) => { this.installation = undefined; throw error })
        const root = await this.installation
        this.lifecycle.signal.throwIfAborted()
        controller.signal.throwIfAborted()
        signal?.throwIfAborted()
        const javaHome = join(root, 'java')
        const fiber = scope.ctx.plugin(mcp, {
          transport: 'stdio', serverName: 'rea', title: 'Decompiler-backed binary analysis',
          command: process.execPath, args: [join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'), '--mcp'],
          cwd: root,
          env: { GHIDRA_INSTALL_DIR: join(root, 'ghidra'), JAVA_HOME: javaHome, JDK_HOME: javaHome,
            PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}` },
          toolCallTimeoutMs: this.config.timeoutMs, failOnStartupError: true, reconnect: { enabled: false },
        })
        try { await fiber } catch (error) { await fiber.dispose(); throw error }
      })().catch(async (error: unknown) => {
        await scope.dispose()
        this.mounts.delete(agent)
        throw error
      })
      this.mounts.set(agent, ready)
    }
    await ready
    signal?.throwIfAborted()
  }

  private async install(): Promise<string> {
    const { reaVersion, ghidraRelease, javaVersion } = this.config
    const operatingSystem = new Map([['darwin', 'mac'], ['linux', 'linux'], ['win32', 'windows']]).get(process.platform)
    const architecture = new Map([['arm64', 'aarch64'], ['x64', 'x64']]).get(process.arch)
    if (operatingSystem === undefined || architecture === undefined) throw new Error(`reverse-engineering is unsupported on ${process.platform}/${process.arch}`)
    const parent = avnHomePath('runtimes', 'reverse-engineering')
    const root = join(parent, `${reaVersion}-${ghidraRelease}-jdk${javaVersion}-${process.platform}-${process.arch}`)
    try {
      await access(join(root, 'ready.json'))
      return root
    } catch (error) {
      // Only an absent completed installation permits a fresh download.
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
    }
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(this.config.timeoutMs)])
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(parent, '.install-'))
    try {
      const release = releaseSchema.parse(await this.json(`https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/tags/${ghidraRelease}`, signal))
      const ghidra = release.assets.find(asset => /^ghidra_.*_PUBLIC_\d+\.zip$/.test(asset.name))
      if (ghidra === undefined) throw new Error(`no Ghidra release archive in ${ghidraRelease}`)
      const assets = javaSchema.parse(await this.json(`https://api.adoptium.net/v3/assets/latest/${javaVersion}/hotspot?architecture=${architecture}&image_type=jdk&os=${operatingSystem}&vendor=eclipse`, signal))
      const java = assets[0]
      if (java === undefined) throw new Error(`no Adoptium JDK ${javaVersion} archive for ${operatingSystem}/${architecture}`)
      for (const [name, archive, zip] of [
        ['ghidra', { link: ghidra.browser_download_url, checksum: ghidra.digest.slice(7) }, true],
        ['java', java.binary.package, process.platform === 'win32'],
      ] as const) {
        const file = join(staging, `${name}.${zip ? 'zip' : 'tar.gz'}`)
        await this.download(archive.link, archive.checksum, file, signal)
        const unpacked = join(staging, `${name}-unpacked`)
        await mkdir(unpacked)
        if (zip && process.platform === 'win32') {
          await this.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
            '$ErrorActionPreference="Stop"; Expand-Archive -LiteralPath $env.ARCHIVE -DestinationPath $env.DESTINATION'], staging, signal,
          { ARCHIVE: file, DESTINATION: unpacked })
        } else await this.run(zip ? ['unzip', '-q', file, '-d', unpacked] : ['tar', '-xzf', file, '-C', unpacked], staging, signal)
        const [directory, ...rest] = (await readdir(unpacked, { withFileTypes: true })).filter(entry => entry.isDirectory())
        if (directory === undefined || rest.length > 0) throw new Error(`unexpected ${name} archive directories`)
        const extracted = join(unpacked, directory.name)
        await rename(name === 'java' && process.platform === 'darwin' ? join(extracted, 'Contents', 'Home') : extracted, join(staging, name))
        await rm(unpacked, { recursive: true })
        await rm(file)
      }
      await this.run([process.platform === 'win32' ? 'npm.cmd' : 'npm', 'install', '--prefix', staging,
        '--no-audit', '--no-fund', '--save-exact', `rea-agents@${reaVersion}`], staging, signal)
      const manifest = JSON.parse(await readFile(join(staging, 'node_modules', 'rea-agents', 'package.json'), 'utf8')) as { version: string }
      if (manifest.version !== reaVersion) throw new Error('installed REA version does not match configuration')
      const javaHome = join(staging, 'java')
      // REA's doctor exits non-zero for informational checks this integration never satisfies — optional engines,
      // client MCP registrations, its own skill copy — so the requested provider's own checks decide, not the status.
      const doctor = await this.capture([process.execPath, join(staging, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'), 'doctor', '--provider', 'ghidra', '--json'], staging, signal,
        { GHIDRA_INSTALL_DIR: join(staging, 'ghidra'), JAVA_HOME: javaHome, JDK_HOME: javaHome,
          PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}` })
      const provider = this.doctorReport(doctor.stdout).providerInspections.find(inspection => inspection.id === 'ghidra')
      const failing = provider?.checks.filter(check => !check.ok) ?? []
      if (provider === undefined || !provider.available || failing.length > 0) {
        throw new Error(`reverse-engineering doctor did not certify ghidra: ${failing.map(check => `${check.name}: ${check.detail ?? 'failed'}`).join('; ') || 'no ghidra inspection'}`)
      }
      await writeFile(join(staging, 'ready.json'), JSON.stringify({ reaVersion, ghidraRelease, javaVersion }) + '\n', { mode: 0o600 })
      await rename(staging, root)
      return root
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  private async json(url: string, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(url, { signal })
    if (!response.ok) throw new Error(`reverse-engineering download failed: ${response.status} ${url}`)
    return await response.json()
  }

  private async download(url: string, checksum: string, file: string, signal: AbortSignal): Promise<void> {
    const response = await fetch(url, { signal })
    if (!response.ok || response.body === null) throw new Error(`reverse-engineering download failed: ${response.status} ${url}`)
    const hash = createHash('sha256')
    const reader = response.body.getReader()
    await pipeline(async function* () {
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          hash.update(value)
          yield value
        }
      } finally { reader.releaseLock() }
    }, createWriteStream(file, { flags: 'wx', mode: 0o600 }), { signal })
    if (hash.digest('hex') !== checksum) throw new Error(`reverse-engineering archive checksum mismatch: ${url}`)
  }

  /**
   * Run one setup program and collect its whole output, whatever its exit status; readers decide whether it succeeded.
   * @param argv - program and arguments.
   * @param cwd - working directory.
   * @param signal - cancellation, process budget, and upload/download limit of the run.
   * @param env - environment for a program that resolves its own toolchain.
   * @returns success, exit description, and captured output.
   */
  private async capture(
    argv: string[],
    cwd: string,
    signal: AbortSignal,
    env?: NodeJS.ProcessEnv,
  ): Promise<{ ok: boolean; exit: string; stdout: string; stderr: string }> {
    const child = this.ctx.subprocess.spawn({ argv, cwd, signal, env, graceMs: this.config.stopGraceMs,
      stdio: { stdin: 'ignore', stdout: { maxBytes: this.config.outputMaxBytes }, stderr: { maxBytes: this.config.outputMaxBytes } } })
    const outcome = await child.done
    signal.throwIfAborted()
    return {
      ok: outcome.exitCode === 0 && outcome.signal === null,
      exit: outcome.signal === null ? `exit ${outcome.exitCode}` : `signal ${outcome.signal}`,
      stdout: child.collected.stdout?.readFrom(0).text ?? '',
      stderr: child.collected.stderr?.readFrom(0).text ?? '',
    }
  }

  private async run(argv: string[], cwd: string, signal: AbortSignal, env?: NodeJS.ProcessEnv): Promise<string> {
    const { ok, exit, stdout, stderr } = await this.capture(argv, cwd, signal, env)
    if (!ok) throw new Error(`reverse-engineering setup failed (${argv[0]}, ${exit}): ${(stderr || stdout).trim() || 'no output'}`)
    return stdout
  }

  /**
   * Parse the doctor's JSON readiness report.
   * @param text - the doctor's stdout.
   * @returns the provider inspections the report carries.
   * @throws when the doctor printed no report, quoting what it printed instead.
   */
  private doctorReport(text: string): z.infer<typeof doctorSchema> {
    try {
      return doctorSchema.parse(JSON.parse(text))
    } catch (error) {
      // The only text this can fail on is the doctor's own output, which the caller cannot otherwise see.
      throw new Error(`reverse-engineering doctor reported no readiness JSON (${error instanceof Error ? error.message : String(error)}): ${text.slice(0, 2_000)}`)
    }
  }
}
