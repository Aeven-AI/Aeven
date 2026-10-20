/** Private, first-use REA/Ghidra installation and agent-scoped MCP ownership. */
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { access, chmod, copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, delimiter, dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@aeven/agent'
import type { SkillSetup } from './types.ts'
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

/** One certified analysis runtime: where REA runs, and the Ghidra and JDK it launches. */
interface Installation {
  /** Directory holding `node_modules/rea-agents`; also the MCP child's working directory. */
  root: string
  /** Ghidra installation root the provider launches `support/analyzeHeadless` from. */
  ghidra: string
  /** JDK home whose `bin/java` runs the provider. */
  javaHome: string
}

const archiveSchema = z.object({ link: z.url(), checksum: z.string().regex(/^[a-f0-9]{64}$/) })
const releaseSchema = z.object({ assets: z.array(z.object({
  name: z.string(), browser_download_url: z.url(), digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
})) })
const javaSchema = z.array(z.object({ binary: z.object({ package: archiveSchema }) })).min(1)
/** What a completed installation records, so a later process mounts the same engine without probing again. */
const manifestSchema = z.object({ ghidra: z.string().min(1), javaHome: z.string().min(1) })
/**
 * Readiness the doctor reports per analysis provider; its own scope and not the process exit status is authoritative.
 * `registrationEnvironment` carries the paths a host-side engine was found at, which is how a machine that already has
 * Ghidra is recognized before anything is downloaded.
 */
const doctorSchema = z.object({ providerInspections: z.array(z.object({
  id: z.string(),
  available: z.boolean(),
  checks: z.array(z.object({ name: z.string(), ok: z.boolean(), detail: z.string().nullish() })).default([]),
  registrationEnvironment: z.object({
    GHIDRA_INSTALL_DIR: z.string().nullish(), JAVA_HOME: z.string().nullish(),
  }).nullish(),
})) })

/** Environment names that would make a host probe report this runtime's own paths instead of the host's. */
const ENGINE_ENV = ['GHIDRA_INSTALL_DIR', 'JAVA_HOME', 'JDK_HOME']

/**
 * Prepare an installed account skill's native analysis tools without changing host software.
 * Downloads are shared by agents; MCP tools belong only to each requesting agent.
 */
export class ReverseEngineeringRuntime {
  private readonly lifecycle = new AbortController()
  private installation: Promise<Installation> | undefined
  private readonly mounts = new WeakMap<Agent, Promise<void>>()
  /** When the last setup failed, so later requests do not repeat a multi-minute download. */
  private failedAt: number | undefined

  /**
   * @param ctx - owning Host context; disposal cancels and drains installation.
   * @param config - validated versions and budgets.
   * @param publish - receives every state change, so Settings can show progress beside the skill's switch.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: ReverseEngineeringConfig,
    private readonly publish: (setup: SkillSetup) => void = () => {},
  ) {
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
    this.background('prepare', () => this.prepare(agent))
  }

  /**
   * Begin installing without an agent that needs it yet, so enabling the skill costs its download before the first
   * request instead of during it. The first request that follows mounts whatever this produced.
   */
  warm(): void {
    this.background('install', () => this.prepareInstallation().then(() => undefined))
  }

  /**
   * Start another attempt now, which the failure dialog offers instead of asking a person to toggle the skill again.
   * Clearing the failure first is what lets the next attempt run inside the retry delay.
   */
  retry(): void {
    this.failedAt = undefined
    this.warm()
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
        const installation = await this.prepareInstallation()
        this.lifecycle.signal.throwIfAborted()
        controller.signal.throwIfAborted()
        signal?.throwIfAborted()
        const { root, ghidra, javaHome } = installation
        const fiber = scope.ctx.plugin(mcp, {
          transport: 'stdio', serverName: 'rea', title: 'Decompiler-backed binary analysis',
          command: process.execPath, args: [join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'), '--mcp'],
          cwd: root,
          env: { GHIDRA_INSTALL_DIR: ghidra, JAVA_HOME: javaHome, JDK_HOME: javaHome,
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

  /**
   * Run one setup attempt in the background, remembering failure so the retry delay is honored across callers.
   * @param task - what the attempt does; a rejection is logged and never reaches the request that started it.
   * @param taskName - word naming the attempt in the logged warning.
   */
  private background(taskName: 'prepare' | 'install', task: () => Promise<void>): void {
    if (this.failedAt !== undefined && Date.now() - this.failedAt < this.config.retryDelayMs) return
    this.publish({ state: 'installing' })
    void task().then(() => { this.publish({ state: 'ready' }) }, (error: unknown) => {
      this.failedAt = Date.now()
      const detail = error instanceof Error ? error.message : String(error)
      this.publish({ state: 'failed', detail })
      this.ctx.logger('account-integrations').warn(`reverse-engineering ${taskName} failed: ${detail}`)
    })
  }

  /**
   * Share one installation across every agent and caller.
   * @returns the certified installation, or the first failure that prevented one.
   */
  private prepareInstallation(): Promise<Installation> {
    this.installation ??= this.install().catch((error: unknown) => { this.installation = undefined; throw error })
    return this.installation
  }

  /**
   * Produce a certified installation, preferring an engine the host already has.
   *
   * Order matters for cost: the REA package is small and every route needs it, a host engine that already certifies
   * needs no download at all, and only a machine without one pays for Ghidra and the JDK.
   * @returns the installation ready to mount.
   */
  private async install(): Promise<Installation> {
    const { reaVersion, ghidraRelease, javaVersion } = this.config
    const operatingSystem = new Map([['darwin', 'mac'], ['linux', 'linux'], ['win32', 'windows']]).get(process.platform)
    const architecture = new Map([['arm64', 'aarch64'], ['x64', 'x64']]).get(process.arch)
    if (operatingSystem === undefined || architecture === undefined) throw new Error(`reverse-engineering is unsupported on ${process.platform}/${process.arch}`)
    const parent = avnHomePath('runtimes', 'reverse-engineering')
    const root = join(parent, `${reaVersion}-${ghidraRelease}-jdk${javaVersion}-${process.platform}-${process.arch}`)
    const completed = await this.completed(root)
    if (completed !== undefined) return completed
    const signal = AbortSignal.any([this.lifecycle.signal, AbortSignal.timeout(this.config.timeoutMs)])
    await mkdir(parent, { recursive: true, mode: 0o700 })
    const staging = await mkdtemp(join(parent, '.install-'))
    try {
      await this.run([process.platform === 'win32' ? 'npm.cmd' : 'npm', 'install', '--prefix', staging,
        '--no-audit', '--no-fund', '--save-exact', `rea-agents@${reaVersion}`], staging, signal)
      const manifest = JSON.parse(await readFile(join(staging, 'node_modules', 'rea-agents', 'package.json'), 'utf8')) as { version: string }
      if (manifest.version !== reaVersion) throw new Error('installed REA version does not match configuration')
      const host = await this.hostEngine(staging, signal)
      if (host === undefined) await this.downloadEngine(staging, signal)
      // Paths are recorded against the directory the staging tree becomes, so a later process reuses them as they are.
      const engine = host ?? { ghidra: join(root, 'ghidra'), javaHome: join(root, 'java') }
      await writeFile(join(staging, 'ready.json'), `${JSON.stringify(engine)}\n`, { mode: 0o600 })
      await rename(staging, root)
      return { root, ...engine }
    } finally { await rm(staging, { recursive: true, force: true }) }
  }

  /**
   * Read a completed installation, if the paths it recorded still exist.
   * @param root - directory one completed installation owns.
   * @returns the installation, or undefined when it is absent, incomplete, or stale.
   */
  private async completed(root: string): Promise<Installation | undefined> {
    try {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(join(root, 'ready.json'), 'utf8')))
      await access(join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs'))
      await access(manifest.ghidra)
      await access(manifest.javaHome)
      return { root, ...manifest }
    } catch {
      // Only a missing, partial, or unparsable manifest reaches this: every other failure belongs to the caller below.
      return undefined
    }
  }

  /**
   * Certify a Ghidra and JDK the host already provides, so a machine with its own engine downloads nothing.
   * @param staging - directory holding the just-installed `rea-agents`, whose doctor performs discovery.
   * @param signal - cancellation and process budget of the doctor run.
   * @returns the host paths when its provider certifies, otherwise undefined.
   */
  private async hostEngine(staging: string, signal: AbortSignal): Promise<{ ghidra: string; javaHome: string } | undefined> {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !ENGINE_ENV.includes(name)))
    try {
      const report = await this.capture([process.execPath, this.reaScript(staging), 'doctor', '--provider', 'ghidra', '--json'], staging, signal, env)
      const provider = this.doctorReport(report.stdout).providerInspections.find(inspection => inspection.id === 'ghidra')
      if (provider === undefined || !provider.available || provider.checks.some(check => !check.ok)) return undefined
      const ghidra = provider.registrationEnvironment?.GHIDRA_INSTALL_DIR
      const javaHome = provider.registrationEnvironment?.JAVA_HOME
      return ghidra !== undefined && ghidra !== null && javaHome !== undefined && javaHome !== null ? { ghidra, javaHome } : undefined
    } catch {
      // A doctor that cannot run or print a report is a host without a certified engine, which the download path covers.
      return undefined
    }
  }

  /**
   * Download, extract, and certify the engine this runtime owns, reusing archives an earlier attempt already fetched.
   * @param staging - installation directory being built.
   * @param signal - cancellation, download, and process budget of every step.
   */
  private async downloadEngine(staging: string, signal: AbortSignal): Promise<void> {
    const { ghidraRelease, javaVersion } = this.config
    const architecture = new Map([['arm64', 'aarch64'], ['x64', 'x64']]).get(process.arch)
    const operatingSystem = new Map([['darwin', 'mac'], ['linux', 'linux'], ['win32', 'windows']]).get(process.platform)
    const release = releaseSchema.parse(await this.json(`https://api.github.com/repos/NationalSecurityAgency/ghidra/releases/tags/${ghidraRelease}`, signal))
    const ghidra = release.assets.find(asset => /^ghidra_.*_PUBLIC_\d+\.zip$/.test(asset.name))
    if (ghidra === undefined) throw new Error(`no Ghidra release archive in ${ghidraRelease}`)
    const [java] = javaSchema.parse(await this.json(`https://api.adoptium.net/v3/assets/latest/${javaVersion}/hotspot?architecture=${architecture}&image_type=jdk&os=${operatingSystem}&vendor=eclipse`, signal))
    if (java === undefined) throw new Error(`no JDK ${javaVersion} archive for ${operatingSystem}/${architecture}`)
    // The macOS archive ships no native decompiler, so the build its own sources describe is the only way to certify it.
    if (process.platform === 'darwin') await this.requireBuildTools(staging, signal)
    const zip = process.platform === 'win32'
    const ghidraArchive = await this.fetchArchive(ghidra.browser_download_url, ghidra.digest.slice(7), '.zip', signal)
    const javaArchive = await this.fetchArchive(java.binary.package.link, java.binary.package.checksum, zip ? '.zip' : '.tar.gz', signal)
    await this.extract(ghidraArchive, true, staging, 'ghidra', signal)
    await this.extract(javaArchive, zip, staging, 'java', signal)
    const javaHome = join(staging, 'java')
    const ghidraRoot = join(staging, 'ghidra')
    await this.ensureDecompiler(ghidraRoot, signal)
    await this.certify(staging, ghidraRoot, javaHome, signal)
  }

  /**
   * Unpack one archive whose single top-level directory becomes the named installation directory.
   * @param archive - verified archive file.
   * @param zip - whether the archive is a ZIP rather than a tarball.
   * @param staging - installation directory being built.
   * @param name - installation directory the archive's contents become.
   * @param signal - cancellation and process budget of the unpacking program.
   */
  private async extract(archive: string, zip: boolean, staging: string, name: string, signal: AbortSignal): Promise<void> {
    const unpacked = join(staging, `${name}-unpacked`)
    await mkdir(unpacked)
    if (zip && process.platform === 'win32') {
      await this.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
        '$ErrorActionPreference="Stop"; Expand-Archive -LiteralPath $env.ARCHIVE -DestinationPath $env.DESTINATION'], staging, signal,
      { ARCHIVE: archive, DESTINATION: unpacked })
    } else await this.run(zip ? ['unzip', '-q', archive, '-d', unpacked] : ['tar', '-xzf', archive, '-C', unpacked], staging, signal)
    const directories = (await readdir(unpacked, { withFileTypes: true })).filter(entry => entry.isDirectory())
    const [only] = directories
    if (only === undefined || directories.length !== 1) throw new Error(`unexpected ${name} archive directories`)
    const extracted = join(unpacked, only.name)
    await rename(name === 'java' && process.platform === 'darwin' ? join(extracted, 'Contents', 'Home') : extracted, join(staging, name))
    await rm(unpacked, { recursive: true })
  }

  /**
   * Build the native decompiler when the archive did not ship one for this platform.
   *
   * Ghidra's release archive carries prebuilt decompilers for Linux and Windows only; on macOS the compiler build its
   * own Makefile describes is the supported route, and REA's doctor refuses the installation without the binary.
   * @param ghidra - extracted Ghidra installation root.
   * @param signal - cancellation and process budget of the build.
   */
  private async ensureDecompiler(ghidra: string, signal: AbortSignal): Promise<void> {
    const target = this.decompilerPath(ghidra)
    if (await this.present(target)) return
    if (process.platform !== 'darwin') throw new Error(`the Ghidra archive ships no decompiler for ${process.platform}/${process.arch}`)
    const source = join(ghidra, 'Ghidra', 'Features', 'Decompiler', 'src', 'decompile', 'cpp')
    await this.run(['make', 'ghidra_opt', `ARCH_TYPE=-arch ${process.arch}`, `OSDIR=${basename(dirname(target))}`, '-j4'], source, signal)
    await mkdir(dirname(target), { recursive: true })
    await copyFile(join(source, 'ghidra_opt'), target)
    await chmod(target, 0o755)
  }

  /**
   * Confirm the compiler toolchain the decompiler build needs is installed.
   * @param cwd - directory the probes run in.
   * @param signal - cancellation and process budget of each probe.
   */
  private async requireBuildTools(cwd: string, signal: AbortSignal): Promise<void> {
    for (const tool of ['make', 'bison']) {
      const probe = await this.capture([tool, '--version'], cwd, signal)
      if (!probe.ok) throw new Error(`the macOS decompiler is built from Ghidra's sources and needs ${tool}, which this host does not provide: install the Xcode command line tools and enable the skill again`)
    }
  }

  /**
   * Path of the native decompiler executable the provider launches.
   * @param ghidra - Ghidra installation root.
   * @returns the executable path for this host's platform and architecture.
   */
  private decompilerPath(ghidra: string): string {
    const operatingSystem = new Map([['darwin', 'mac'], ['linux', 'linux'], ['win32', 'win']]).get(process.platform)
    const architecture = new Map([['arm64', 'arm_64'], ['x64', 'x86_64']]).get(process.arch)
    const directory = operatingSystem !== undefined && architecture !== undefined ? `${operatingSystem}_${architecture}` : undefined
    if (directory === undefined) throw new Error(`no decompiler directory for ${process.platform}/${process.arch}`)
    return join(ghidra, 'Ghidra', 'Features', 'Decompiler', 'os', directory, 'decompile')
  }

  /**
   * Require the downloaded engine to certify, so a mount never starts a provider REA itself rejects.
   * @param staging - installation directory being built.
   * @param ghidra - Ghidra installation root under test.
   * @param javaHome - JDK home under test.
   * @param signal - cancellation and process budget of the doctor run.
   */
  private async certify(staging: string, ghidra: string, javaHome: string, signal: AbortSignal): Promise<void> {
    // REA's doctor exits non-zero for informational checks this integration never satisfies — optional engines,
    // client MCP registrations, its own skill copy — so the requested provider's own checks decide, not the status.
    const doctor = await this.capture([process.execPath, this.reaScript(staging), 'doctor', '--provider', 'ghidra', '--json'], staging, signal,
      { GHIDRA_INSTALL_DIR: ghidra, JAVA_HOME: javaHome, JDK_HOME: javaHome,
        PATH: `${join(javaHome, 'bin')}${delimiter}${process.env.PATH ?? ''}` })
    const provider = this.doctorReport(doctor.stdout).providerInspections.find(inspection => inspection.id === 'ghidra')
    const failing = provider?.checks.filter(check => !check.ok) ?? []
    if (provider === undefined || !provider.available || failing.length > 0) {
      throw new Error(`reverse-engineering doctor did not certify ghidra: ${failing.map(check => `${check.name}: ${check.detail ?? 'failed'}`).join('; ') || 'no ghidra inspection'}`)
    }
  }

  /**
   * Path of the REA entry script inside one installation directory.
   * @param root - directory holding `node_modules/rea-agents`.
   * @returns the script path to run with this process's Node.
   */
  private reaScript(root: string): string {
    return join(root, 'node_modules', 'rea-agents', 'scripts', 'rea.mjs')
  }

  /** Whether a path exists, for a directory entry this runtime may or may not have created yet. */
  private async present(path: string): Promise<boolean> {
    try { await access(path); return true } catch { return false }
  }

  /**
   * Reuse a verified archive or download it once into the content-addressed cache.
   * @param url - archive location.
   * @param checksum - SHA-256 the archive must have.
   * @param extension - archive suffix, so two hosts never collide on one checksum.
   * @param signal - cancellation, download budget, and checksum of the transfer.
   * @returns the cached archive path.
   */
  private async fetchArchive(url: string, checksum: string, extension: string, signal: AbortSignal): Promise<string> {
    const directory = join(avnHomePath('runtimes', 'reverse-engineering'), 'archives')
    const file = join(directory, `${checksum}${extension}`)
    if (await this.present(file) && await this.hashOf(file) === checksum) return file
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const part = `${file}.part`
    await rm(part, { force: true })
    try {
      await this.download(url, checksum, part, signal)
      await rename(part, file)
    } catch (error) {
      // A rejected transfer leaves its partial file behind; only the caller's cache and the next attempt may see it.
      await rm(part, { force: true })
      throw error
    }
    return file
  }

  /**
   * SHA-256 of a file already on disk, so a cached archive is trusted only while its bytes still match.
   * @param file - absolute path.
   * @returns the lowercase hex digest.
   */
  private async hashOf(file: string): Promise<string> {
    const hash = createHash('sha256')
    await pipeline(createReadStream(file), async (source: AsyncIterable<Uint8Array>) => {
      for await (const chunk of source) hash.update(chunk)
    })
    return hash.digest('hex')
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
    argv: string[], cwd: string, signal: AbortSignal, env?: NodeJS.ProcessEnv,
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
