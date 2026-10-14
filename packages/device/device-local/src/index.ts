/**
 * The device host that is this machine, ported from t3code's LocalDeviceHost.
 *
 * Runs expo-device-hub as a supervised child on a loopback port and, once the
 * user grants model access, starts the agent-device daemon in HTTP mode under
 * the device state directory. Both are lazy: the device service calls
 * `ensureReady` only after the user enables device support.
 *
 * The hub runs in its standalone mode at its origin root; the hub proxy strips
 * its own mount, and the device pane builds every stream and socket URL from
 * that mount rather than from anything the hub prints.
 *
 * @module @aeven/device-local
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  LOCAL_DEVICE_HOST_ID,
  type AgentDeviceEndpoint, type DeviceCommandOptions, type DeviceCommandResult, type DeviceHost,
  type DeviceHostAgentReady, type DeviceHostPhaseListener, type DeviceHostReady, type DeviceHostSummary,
  type DevicePlatform, type DevicePlatformAvailability,
} from '@aeven/device'
import { avnHomePath } from '@aeven/home-paths'
import { deviceEnvironment, findAndroidSdk, findJavaHome, platformReason, type AndroidSdk } from './platforms.ts'
import { ensureTool, installMessage, isToolInstalled, type ToolPaths, type ToolSpec } from './toolchain.ts'

/** Stable Cordis plugin name. */
export const name = 'device-local'

/** The device service this host registers into. */
export const inject = ['devices']

/** Pinned tools, install location, and process deadlines. */
export interface Config {
  /** expo-device-hub version to install and run. */
  hubVersion: string
  /** agent-device version to install and run; `device_open`'s instructions are written for it. */
  agentVersion: string
  /** Root of the pinned installs. Omit for `<AVN_HOME>/runtime/device-tools`. */
  toolsDir?: string
  /** Node executable the tools run with. */
  nodePath: string
  /** npm executable used to install the tools. */
  npmPath: string
  /** Deadline for one tool install, in ms. */
  installTimeoutMs: number
  /** Deadline for the hub to answer after spawning, in ms. */
  hubReadyTimeoutMs: number
  /** Deadline for the agent-device daemon to answer, in ms. */
  agentReadyTimeoutMs: number
  /** Hub uptime after which a crash restarts it without backoff, in ms. */
  hubStableUptimeMs: number
  /** Longest backoff before restarting a crashing hub, in ms. */
  hubRestartMaxDelayMs: number
  /** Default deadline for one device command, in ms. */
  commandTimeoutMs: number
}

export const Config: z<Config> = z.object({
  hubVersion: z.string().default('0.10.1'),
  agentVersion: z.string().default('0.21.12'),
  toolsDir: z.string(),
  nodePath: z.string().default(process.execPath),
  npmPath: z.string().default('npm'),
  installTimeoutMs: z.number().step(1).min(1).default(600_000),
  hubReadyTimeoutMs: z.number().step(1).min(1).default(30_000),
  agentReadyTimeoutMs: z.number().step(1).min(1).default(30_000),
  hubStableUptimeMs: z.number().step(1).min(0).default(60_000),
  hubRestartMaxDelayMs: z.number().step(1).min(1).default(30_000),
  commandTimeoutMs: z.number().step(1).min(1).default(20_000),
})

/** How often a starting hub or daemon is polled, in ms. */
const READY_POLL_MS = 100

interface HubProcess {
  readonly child: ChildProcess
  readonly origin: string
  readonly startedAt: number
}

interface Running {
  readonly hub: HubProcess
  readonly hubTool: ToolPaths
  readonly helpers: DeviceHostReady['helpers']
  agentDevice: AgentDeviceEndpoint | undefined
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** A free loopback port, released for the hub to bind. */
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(() => {
        if (typeof address === 'object' && address !== null) resolve(address.port)
        else reject(new Error('no port'))
      })
    })
  })
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH: no such process. EPERM would mean alive but foreign; the hub is always ours.
    return false
  }
}

async function answers(url: string, timeoutMs: number): Promise<boolean> {
  return await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
    .then(async (response) => { await response.arrayBuffer(); return response.ok }, () => false)
}

/** The machine the Host runs on, as a device host. */
export class LocalDeviceHost implements DeviceHost {
  readonly id = LOCAL_DEVICE_HOST_ID
  private readonly toolsDir: string
  private readonly agentStateDir: string
  private readonly hubSpec: ToolSpec
  private readonly agentSpec: ToolSpec
  private readonly env: NodeJS.ProcessEnv
  private running: Running | undefined
  private restartDelay = 0
  private stopped = false
  /** Serializes start, restart, and stop, so concurrent callers share one start. */
  private queue: Promise<unknown> = Promise.resolve()

  /**
   * @param ctx - owning context, for logging.
   * @param config - pinned tools and deadlines.
   * @param stateDir - the device service's state directory.
   * @param sdk - the Android SDK found at startup.
   * @param javaHome - the Java runtime for the SDK's command-line tools, when found.
   */
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
    stateDir: string,
    private readonly sdk: AndroidSdk,
    javaHome: string | undefined,
  ) {
    this.toolsDir = config.toolsDir ?? avnHomePath('runtime', 'device-tools')
    this.agentStateDir = join(stateDir, 'agent-device')
    this.hubSpec = { name: 'expo-device-hub', version: config.hubVersion, entry: ['dist', 'server', 'cli.mjs'] }
    this.agentSpec = { name: 'agent-device', version: config.agentVersion, entry: ['bin', 'agent-device.mjs'] }
    this.env = deviceEnvironment(process.env, sdk.root, javaHome)
  }

  async platformAvailability(platform: DevicePlatform): Promise<DevicePlatformAvailability> {
    const reason = await platformReason(platform, this.sdk, this.env)
    return reason === undefined ? { platform, available: true } : { platform, available: false, reason }
  }

  async summary(): Promise<DeviceHostSummary> {
    const [ios, android, hubInstalled, agentInstalled] = await Promise.all([
      this.platformAvailability('ios'),
      this.platformAvailability('android'),
      isToolInstalled(this.toolsDir, this.hubSpec),
      isToolInstalled(this.toolsDir, this.agentSpec),
    ])
    return { id: this.id, kind: 'local', label: 'This machine', platforms: [ios, android], hubInstalled, agentInstalled }
  }

  current(): DeviceHostReady | undefined {
    const running = this.running
    return running === undefined || running.hub.child.exitCode !== null ? undefined : this.toReady(running)
  }

  ensureReady(onPhase: DeviceHostPhaseListener): Promise<DeviceHostReady> {
    return this.serialize(async () => this.toReady(await this.ensureHub(onPhase)))
  }

  ensureAgentReady(onPhase: DeviceHostPhaseListener): Promise<DeviceHostAgentReady> {
    return this.serialize(async () => {
      const running = await this.ensureHub(onPhase)
      if (running.agentDevice === undefined) {
        if (!await isToolInstalled(this.toolsDir, this.agentSpec)) onPhase('installing', installMessage('agent tools', this.agentSpec.version))
        const tool = await ensureTool(this.toolsDir, this.agentSpec, this.config.npmPath, this.config.installTimeoutMs)
        onPhase('starting')
        running.agentDevice = await this.startAgentDaemon(tool)
      }
      return { ...this.toReady(running), agentDevice: running.agentDevice }
    })
  }

  stopAgent(): Promise<void> {
    return this.serialize(async () => {
      await this.stopAgentDaemon()
      if (this.running !== undefined) this.running.agentDevice = undefined
    })
  }

  stop(): Promise<void> {
    return this.serialize(async () => {
      const running = this.running
      this.running = undefined
      if (running !== undefined) await this.killHub(running.hub)
      await rm(this.hubStatePath(), { force: true })
      await this.stopAgentDaemon()
    })
  }

  /** Mark the host disposed, so a crashed hub is not restarted after the plugin unloads. */
  dispose(): Promise<void> {
    this.stopped = true
    return this.stop()
  }

  /**
   * Run a device command where the devices live. `emulator` resolves inside
   * the SDK, since it is not on PATH by default.
   */
  readonly run = (command: string, args: readonly string[], options?: DeviceCommandOptions): Promise<DeviceCommandResult> => {
    const executable = command === 'emulator' && this.sdk.root !== undefined
      ? join(this.sdk.root, 'emulator', process.platform === 'win32' ? 'emulator.exe' : 'emulator')
      : command
    return new Promise((resolve) => {
      const child = spawn(executable, args, { env: this.env, stdio: ['pipe', 'pipe', 'pipe'] })
      let stdout = ''
      let stderr = ''
      child.stdout.setEncoding('utf8').on('data', (chunk: string) => { stdout += chunk })
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
      const timer = setTimeout(() => { child.kill('SIGKILL') }, options?.timeoutMs ?? this.config.commandTimeoutMs)
      child.on('error', (error) => {
        clearTimeout(timer)
        resolve({ stdout, stderr: error.message, code: 127 })
      })
      child.on('close', (code) => {
        clearTimeout(timer)
        resolve({ stdout, stderr, code: code ?? 1 })
      })
      child.stdin.end(options?.stdin)
    })
  }

  private serialize<T>(run: () => Promise<T>): Promise<T> {
    const next = this.queue.then(run, run)
    this.queue = next.catch(() => undefined)
    return next
  }

  private toReady(running: Running): DeviceHostReady {
    return { nodePath: this.config.nodePath, hubOrigin: running.hub.origin, run: this.run, helpers: running.helpers }
  }

  private async ensureHub(onPhase: DeviceHostPhaseListener): Promise<Running> {
    if (this.running !== undefined && this.running.hub.child.exitCode === null) return this.running
    this.running = undefined
    if (!await isToolInstalled(this.toolsDir, this.hubSpec)) onPhase('installing', installMessage('device hub', this.hubSpec.version))
    const hubTool = await ensureTool(this.toolsDir, this.hubSpec, this.config.npmPath, this.config.installTimeoutMs)
    onPhase('starting')
    const hub = await this.spawnHub(hubTool)
    const serveSim = join(hubTool.installDir, 'node_modules', 'expo-device-hub', 'vendor', 'serve-sim', 'dist')
    const axSettings = join(serveSim, 'simax', 'serve-sim-ax-settings')
    const serveSimCli = join(serveSim, 'serve-sim.js')
    const has = (file: string) => access(file).then(() => true, () => false)
    const running: Running = {
      hub,
      hubTool,
      helpers: { axSettings: await has(axSettings) ? axSettings : null, serveSimCli: await has(serveSimCli) ? serveSimCli : null },
      agentDevice: undefined,
    }
    this.running = running
    this.restartDelay = 0
    this.supervise(running)
    return running
  }

  private hubStatePath(): string {
    return join(this.agentStateDir, 'hub.json')
  }

  /**
   * A Host killed without running its disposers (SIGKILL, a dev restart)
   * leaves its hub bound to a loopback port. The next start stops that hub,
   * identified by pid and by its command line naming the hub's entry, so a
   * recycled pid belonging to something else is never touched.
   */
  private async reapStaleHub(): Promise<void> {
    const raw = await readFile(this.hubStatePath(), 'utf8').catch(() => undefined)
    if (raw === undefined) return
    let previous: { pid?: unknown; entryPath?: unknown }
    try {
      previous = JSON.parse(raw) as { pid?: unknown; entryPath?: unknown }
    } catch {
      // A truncated record names no process to stop.
      previous = {}
    }
    if (typeof previous.pid === 'number' && typeof previous.entryPath === 'string' && isAlive(previous.pid)) {
      const commandLine = await this.run('ps', ['-o', 'command=', '-p', String(previous.pid)], { timeoutMs: 5_000 })
      if (commandLine.stdout.includes(previous.entryPath)) {
        this.ctx.logger.warn('stopping a device hub left behind by a previous Host (pid %d)', previous.pid)
        try {
          process.kill(previous.pid, 'SIGTERM')
        } catch {
          // It exited between the check and the signal.
        }
      }
    }
    await rm(this.hubStatePath(), { force: true })
  }

  private async spawnHub(hubTool: ToolPaths): Promise<HubProcess> {
    await this.reapStaleHub()
    await mkdir(this.agentStateDir, { recursive: true })
    const port = await reservePort()
    const origin = `http://127.0.0.1:${String(port)}`
    const child = spawn(this.config.nodePath, [
      hubTool.entryPath, '--port', String(port), '--host', '127.0.0.1', '--hide-sidebar', '--hide-boot-device',
    ], { env: { ...this.env, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'] })
    const log = (chunk: Buffer) => {
      for (const line of chunk.toString('utf8').split('\n')) {
        if (line.trim() !== '') this.ctx.logger.debug('device hub: %s', line.trim())
      }
    }
    child.stdout.on('data', log)
    child.stderr.on('data', log)
    const exited = new Promise<void>((resolve) => { child.once('exit', () => { resolve() }) })
    child.once('error', (error) => { this.ctx.logger.warn('device hub failed to start: %s', error.message) })
    const hub: HubProcess = { child, origin, startedAt: Date.now() }
    const deadline = Date.now() + this.config.hubReadyTimeoutMs
    while (!await answers(`${origin}/readyz`, 2_000)) {
      if (child.exitCode !== null || child.signalCode !== null || Date.now() > deadline) {
        await this.killHub(hub)
        throw new Error(child.exitCode === null ? 'the device hub did not answer in time' : `the device hub exited (${String(child.exitCode)})`)
      }
      await Promise.race([sleep(READY_POLL_MS), exited])
    }
    await writeFile(this.hubStatePath(), JSON.stringify({ pid: child.pid, port, entryPath: hubTool.entryPath }))
    this.ctx.logger.info('device hub started (pid %d, port %d)', child.pid ?? -1, port)
    return hub
  }

  /** Restart a hub that dies under us, with doubling backoff so a hub that crashes on boot cannot spin. */
  private supervise(running: Running): void {
    running.hub.child.once('exit', () => {
      if (this.stopped || this.running?.hub !== running.hub) return
      const uptime = Date.now() - running.hub.startedAt
      const delay = uptime >= this.config.hubStableUptimeMs ? 0 : this.restartDelay
      this.restartDelay = uptime >= this.config.hubStableUptimeMs
        ? 0
        : Math.min(this.restartDelay === 0 ? 1_000 : this.restartDelay * 2, this.config.hubRestartMaxDelayMs)
      this.ctx.logger.warn('device hub exited; restarting in %d ms', delay)
      void sleep(delay).then(() => this.serialize(async () => {
        if (this.stopped || this.running?.hub !== running.hub) return
        const hub = await this.spawnHub(running.hubTool)
        const replacement: Running = { ...running, hub }
        this.running = replacement
        this.supervise(replacement)
      })).catch((error: unknown) => {
        this.ctx.logger.warn('device hub restart failed: %s', error instanceof Error ? error.message : String(error))
      })
    })
  }

  private async killHub(hub: HubProcess): Promise<void> {
    if (hub.child.exitCode !== null || hub.child.signalCode !== null) return
    const exited = new Promise<void>((resolve) => { hub.child.once('exit', () => { resolve() }) })
    hub.child.kill('SIGTERM')
    await Promise.race([exited, sleep(5_000).then(() => { hub.child.kill('SIGKILL') })])
  }

  private daemonFilePath(): string {
    return join(this.agentStateDir, 'daemon.json')
  }

  private async readDaemonFile(): Promise<{ httpPort: number; token: string } | undefined> {
    const raw = await readFile(this.daemonFilePath(), 'utf8').catch(() => undefined)
    if (raw === undefined) return undefined
    try {
      const parsed = JSON.parse(raw) as { httpPort?: unknown; token?: unknown }
      return typeof parsed.httpPort === 'number' && typeof parsed.token === 'string'
        ? { httpPort: parsed.httpPort, token: parsed.token }
        : undefined
    } catch {
      // A daemon still writing its file has not started yet.
      return undefined
    }
  }

  /**
   * agent-device has no `daemon start`: the first command in a state
   * directory spawns the daemon and blocks until it answers, and `devices` is
   * the cheapest one. The daemon's own file then names its port and token.
   */
  private async startAgentDaemon(tool: ToolPaths): Promise<AgentDeviceEndpoint> {
    await mkdir(this.agentStateDir, { recursive: true })
    const toEndpoint = (file: { httpPort: number; token: string }): AgentDeviceEndpoint => ({
      baseUrl: `http://127.0.0.1:${String(file.httpPort)}`, token: file.token, entryPath: tool.entryPath,
    })
    const existing = await this.readDaemonFile()
    if (existing !== undefined) {
      if (await answers(`http://127.0.0.1:${String(existing.httpPort)}/health`, 2_000)) return toEndpoint(existing)
      await rm(this.daemonFilePath(), { force: true })
    }
    await new Promise<void>((resolve) => {
      const child = spawn(this.config.nodePath, [tool.entryPath, 'devices', '--json'], {
        env: {
          ...this.env,
          AGENT_DEVICE_STATE_DIR: this.agentStateDir,
          AGENT_DEVICE_DAEMON_SERVER_MODE: 'http',
          // The daemon idles out after five minutes by default; this host owns
          // its lifetime and stops it explicitly.
          AGENT_DEVICE_DAEMON_IDLE_TIMEOUT_MS: '0',
          AGENT_DEVICE_NO_UPDATE_NOTIFIER: '1',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
        },
        stdio: 'ignore',
      })
      const timer = setTimeout(() => { child.kill('SIGKILL') }, this.config.agentReadyTimeoutMs)
      child.once('error', () => { clearTimeout(timer); resolve() })
      child.once('exit', () => { clearTimeout(timer); resolve() })
    })
    const deadline = Date.now() + this.config.agentReadyTimeoutMs
    for (;;) {
      const file = await this.readDaemonFile()
      if (file !== undefined) return toEndpoint(file)
      if (Date.now() > deadline) throw new Error(`agent tools did not start within ${String(this.config.agentReadyTimeoutMs)} ms`)
      await sleep(READY_POLL_MS)
    }
  }

  private async stopAgentDaemon(): Promise<void> {
    const entry = join(this.toolsDir, this.agentSpec.name, this.agentSpec.version, 'node_modules', this.agentSpec.name, ...this.agentSpec.entry)
    if (!await access(entry).then(() => true, () => false)) return
    await this.run(this.config.nodePath, [entry, 'daemon', 'stop', '--state-dir', this.agentStateDir], { timeoutMs: 10_000 })
  }
}

/**
 * Register this machine as the local device host.
 * @param ctx - plugin context carrying the device service.
 * @param config - pinned tools and deadlines.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const [sdk, javaHome] = await Promise.all([findAndroidSdk(process.env), findJavaHome(process.env)])
  const host = new LocalDeviceHost(ctx, config, ctx.devices.stateDir, sdk, javaHome)
  ctx.effect(() => {
    const unregister = ctx.devices.registerHost(host)
    return async () => {
      unregister()
      await host.dispose()
    }
  }, 'device-local: local host')
}
