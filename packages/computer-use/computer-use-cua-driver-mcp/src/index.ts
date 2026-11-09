/**
 * Exclusive computer use through an installed or host-shipped Cua Driver MCP executable.
 * The MCP client owns discovery, execution, image admission, and reconnection.
 * An absolute `command` that does not exist registers only an install tool.
 * @module
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { connect } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import type { Context, Fiber } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ComputerUseProviderName } from '@aeven/computer-use/brand'
import * as McpClient from '@aeven/mcp-client'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/computer-use'

/** Cordis plugin identity for the installed Cua Driver provider. */
export const name = 'computer-use-cua-driver-mcp'

/** The shared reservation and tool registry must exist before connection. */
export const inject = ['computerUse', 'tools']

/** Installed executable and MCP connection overrides. */
export interface Config {
  /** Executable path or PATH command; defaults to `cua-driver`. */
  command: string
  /** Arguments passed without a shell; defaults to `['mcp']`. */
  args: string[]
  /**
   * Run the driver as an embedded child of the application hosting this process
   * instead of as the standalone CuaDriver app. On macOS the driver then holds
   * no permission identity of its own: Accessibility and Screen Recording are
   * the host application's grants, and the setup tool requests them for it.
   * On macOS the provider starts the driver as a `serve --embedded` daemon of
   * its own, which draws the agent cursor; elsewhere the MCP child owns the
   * runtime with `--direct`. Defaults to `false`.
   */
  embedded: boolean
  /** Per-call timeout in milliseconds; omission uses the MCP client's default. */
  toolCallTimeoutMs?: number
  /** Reconnection overrides; defaults to the MCP client's policy. */
  reconnect: McpClient.ReconnectConfig
  /**
   * Hold activation until the driver connects and its tools are discovered, and fail activation when it cannot
   * start. Off, the row activates at once, the driver's tools register when it connects, and a failed start is
   * logged while the client keeps reconnecting. Defaults to `true`.
   */
  awaitStartup: boolean
  /**
   * Raw driver tool names the model may call; every other discovered tool gets no executor. Defaults to
   * {@link DEFAULT_ALLOWED_TOOLS}, which leaves out driver configuration, updates, extension installs, process
   * killing, trajectory recording and replay, cursor styling, and deprecated tools.
   */
  allowedTools: string[]
  /** Let the driver send its usage telemetry to Cua. Off sets `DO_NOT_TRACK=1` for the driver. Defaults to `false`. */
  telemetry: boolean
  /**
   * Oldest driver version this provider accepts, as `major.minor.patch`. An older driver is not started; the
   * setup tool tells the person to update it. Defaults to `0.35.0`, the first release with the batched
   * `run_steps` and `run_script` tools the computer-use skill uses.
   */
  minimumVersion: string
  /**
   * How long the driver watches for a window an action opened, in milliseconds (0 to 10000). Shorter is faster
   * but ends the driver's protection against apps stealing focus sooner. Applies only where the driver runtime
   * runs in this child (`embedded`, or `--direct` in `args`). Omitted keeps the driver's default.
   */
  windowChangeTimeoutMs?: number
  /**
   * Gap between synthesized key events on macOS, in milliseconds (2 to 100). Shorter types faster; some apps
   * drop keys that arrive back to back. Same runtime condition as `windowChangeTimeoutMs`. Omitted keeps the
   * driver's default.
   */
  keyGapMs?: number
  /**
   * Hold a driver call that brings a window forward or moves the pointer while the person has used their
   * mouse or keyboard within this many milliseconds. Input that arrives while a driver call runs, or before
   * the last driver call ended, counts as the driver's own. Background calls are never held. `0` turns the
   * hold off. Defaults to `3000`.
   */
  holdForegroundWhileActiveMs: number
  /**
   * How long a held call waits for the person to pause before it is refused, in milliseconds. `0` refuses at
   * once. Defaults to `10000`.
   */
  foregroundWaitMs: number
}

/**
 * Driver tools the model may call by default. Everything a desktop task needs stays: discovery, reads,
 * actions, batches, verification, clipboard, menus, window geometry, browser page tools, sessions, and
 * diagnostics. Names a given driver release lacks are ignored.
 */
export const DEFAULT_ALLOWED_TOOLS: readonly string[] = [
  'check_permissions', 'health_report', 'get_guide',
  'list_apps', 'list_windows', 'launch_app', 'bring_to_front', 'set_window_frame',
  'get_window_state', 'get_desktop_state', 'get_accessibility_tree', 'get_screen_size', 'get_cursor_position',
  'zoom', 'parse_visual_regions', 'verify_state',
  'run_steps', 'run_script',
  'click', 'double_click', 'right_click', 'drag', 'scroll', 'move_cursor',
  'type_text', 'press_key', 'hotkey', 'set_value', 'invoke_menu',
  'clipboard_read', 'clipboard_write',
  'get_browser_state', 'browser_prepare', 'browser_navigate', 'browser_click', 'browser_type', 'browser_pointer',
  'browser_select', 'browser_dialog', 'browser_download', 'browser_set_input_files',
  'start_session', 'end_session',
]

/** Validate executable options; the MCP client resolves connection defaults. */
export const Config: z<Partial<Config>, Config> = z.object({
  command: z.string().pattern(/[^\s]/u).default('cua-driver'),
  args: z.array(String).default(['mcp']),
  embedded: z.boolean().default(false),
  awaitStartup: z.boolean().default(true),
  allowedTools: z.array(String).default([...DEFAULT_ALLOWED_TOOLS]),
  telemetry: z.boolean().default(false),
  minimumVersion: z.string().pattern(/^\d+\.\d+\.\d+$/u).default('0.35.0'),
  windowChangeTimeoutMs: z.number().min(0).max(10_000).step(1),
  keyGapMs: z.number().min(2).max(100).step(1),
  holdForegroundWhileActiveMs: z.number().min(0).step(1).default(3_000),
  foregroundWaitMs: z.number().min(0).step(1).default(10_000),
  toolCallTimeoutMs: z.number().min(1),
  reconnect: z.object({
    enabled: z.boolean(),
    initialDelayMs: z.number().min(1),
    maxDelayMs: z.number().min(1),
    maxAttempts: z.number().min(1).step(1),
  }),
})

/**
 * The driver's opt-in switch for its native-Wayland backend.
 *
 * A Wayland session needs it: without that backend the driver stays on the X11
 * path, where a Wayland desktop reports no windows and desktop capture fails.
 * An X11 session already works, so it gets no extra variable.
 */
export const WAYLAND_BACKEND_ENV = 'CUA_DRIVER_RS_ENABLE_WAYLAND'

/**
 * The driver's embedded-mode switch; only the exact value `1` enables it. An
 * embedded driver never disclaims its parent's permission identity, never
 * relaunches itself through LaunchServices, and never raises a permission prompt.
 */
export const EMBEDDED_ENV = 'CUA_DRIVER_EMBEDDED'

/**
 * The extra environment the driver child needs for the session it will drive.
 * Wayland is detected the way the desktop picker detects a display:
 * `WAYLAND_DISPLAY`, or `XDG_SESSION_TYPE` naming Wayland.
 * @param platform - the platform running the driver.
 * @param env - that machine's environment.
 * @returns extra variables for the MCP child, empty when the session needs none.
 */
export function driverEnv(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
): Record<string, string> {
  if (platform !== 'linux') return {}
  const named = (value: string | undefined): boolean => value !== undefined && value !== ''
  return named(env.WAYLAND_DISPLAY) || env.XDG_SESSION_TYPE === 'wayland'
    ? { [WAYLAND_BACKEND_ENV]: '1' }
    : {}
}

/**
 * Environment from the provider's own settings: the telemetry opt-out and the runtime tuning variables the
 * driver reads at launch.
 * @param config - validated provider options.
 * @returns extra variables for the driver child.
 */
export function settingsEnv(config: Pick<Config, 'telemetry' | 'windowChangeTimeoutMs' | 'keyGapMs'>): Record<string, string> {
  return {
    ...config.telemetry ? {} : { DO_NOT_TRACK: '1' },
    ...config.windowChangeTimeoutMs === undefined ? {} : { CUA_DRIVER_WINDOW_CHANGE_TIMEOUT_MS: String(config.windowChangeTimeoutMs) },
    ...config.keyGapMs === undefined ? {} : { CUA_DRIVER_KEY_GAP_MS: String(config.keyGapMs) },
  }
}

/**
 * Parse a `major.minor.patch` version out of driver output such as `cua-driver 0.45.2`.
 * @param text - the driver's `--version` output.
 * @returns the three numbers, or `undefined` when the text names no version.
 */
export function parseVersion(text: string): [number, number, number] | undefined {
  const match = /(\d+)\.(\d+)\.(\d+)/u.exec(text)
  return match === null ? undefined : [Number(match[1]), Number(match[2]), Number(match[3])]
}

/**
 * Whether `found` is at least `minimum`.
 * @param found - the installed version.
 * @param minimum - the oldest accepted version.
 * @returns true when `found` is the same or newer.
 */
export function versionAtLeast(found: readonly [number, number, number], minimum: readonly [number, number, number]): boolean {
  for (const index of [0, 1, 2] as const) {
    if (found[index] !== minimum[index]) return found[index] > minimum[index]
  }
  return true
}

/**
 * Run one bounded driver subcommand and resolve its stdout.
 * @param command - the driver executable.
 * @param args - the subcommand and its flags.
 * @param env - extra environment for the child.
 * @returns stdout, or `undefined` when the command failed or timed out.
 */
function runDriver(command: string, args: string[], env: Record<string, string>): Promise<string | undefined> {
  return new Promise((resolve) => {
    // stdin closes at once, so a command that ignores the flag and waits for
    // input ends instead of running into the timeout.
    execFile(command, args, { timeout: 10_000, env: { ...process.env, ...env } }, (error, stdout) => {
      resolve(error === null ? stdout : undefined)
    }).stdin?.end()
  })
}

/**
 * The MCP child's arguments. An embedded driver connects through the socket of
 * the daemon this provider started when one is given, and otherwise owns the
 * runtime in the MCP child with `--direct`.
 * @param config - validated executable options.
 * @param socket - private socket of the provider's embedded daemon, if any.
 * @returns arguments for the MCP child.
 */
export function driverArgs(config: Pick<Config, 'args' | 'embedded'>, socket?: string): string[] {
  if (!config.embedded) return config.args
  return socket === undefined ? [...config.args, '--embedded', '--direct'] : [...config.args, '--embedded', '--socket', socket]
}

/**
 * Whether an embedded driver runs as a daemon this provider starts. On macOS
 * the agent cursor overlay needs the daemon's AppKit run loop; a `--direct`
 * runtime refuses every overlay call.
 * @param config - validated provider options.
 * @param platform - the platform running the driver.
 * @returns true when the provider owns a `serve --embedded` daemon.
 */
export function usesEmbeddedDaemon(config: Pick<Config, 'embedded'>, platform: NodeJS.Platform): boolean {
  return config.embedded && platform === 'darwin'
}

/** Prefix of every driver tool the model calls. */
const DRIVER_TOOL_PREFIX = 'mcp__cua-driver-mcp__'

/**
 * Whether one driver call brings a window forward, moves the real pointer, or
 * sends input to the whole desktop, instead of acting on a window in the
 * background.
 * @param tool - the raw driver tool name.
 * @param args - the call's arguments.
 * @returns true for a foreground call.
 */
export function isForegroundCall(tool: string, args: unknown): boolean {
  const record = (value: unknown): Record<string, unknown> | undefined =>
    typeof value === 'object' && value !== null ? value as Record<string, unknown> : undefined
  const foreground = (value: unknown): boolean => {
    const fields = record(value)
    return fields !== undefined && (fields.delivery_mode === 'foreground' || record(fields.target)?.kind === 'desktop')
  }
  const fields = record(args)
  if (tool === 'bring_to_front' || foreground(fields)) return true
  if (tool === 'run_steps' && fields !== undefined) {
    if (fields.foreground_fallback === true) return true
    const steps = Array.isArray(fields.steps) ? fields.steps : []
    return steps.some(step => foreground(record(step)?.args) || Object.values(record(step) ?? {}).some(foreground))
  }
  if (tool === 'run_script') return typeof fields?.script === 'string' && /foreground/u.test(fields.script)
  return false
}

/** Prints milliseconds since the signed-in person's last keyboard or mouse input on Windows. */
const WINDOWS_IDLE_SCRIPT = 'Add-Type -TypeDefinition \'using System;using System.Runtime.InteropServices;public static class AvnIdle{[StructLayout(LayoutKind.Sequential)]struct L{public uint cbSize;public uint dwTime;}[DllImport("user32.dll")]static extern bool GetLastInputInfo(ref L l);public static uint Ms(){L l=new L();l.cbSize=(uint)Marshal.SizeOf(l);GetLastInputInfo(ref l);return (uint)Environment.TickCount-l.dwTime;}}\'; [AvnIdle]::Ms()'

/**
 * Milliseconds since the person last used the keyboard or mouse: macOS reads
 * `HIDIdleTime`, GNOME its idle monitor, Windows `GetLastInputInfo`.
 * @param platform - the platform hosting the desktop.
 * @returns the idle time, or `undefined` where it cannot be read.
 */
async function userIdleMs(platform: NodeJS.Platform): Promise<number | undefined> {
  if (platform === 'darwin') {
    const out = await runDriver('/usr/sbin/ioreg', ['-c', 'IOHIDSystem', '-d', '4', '-r', '-k', 'HIDIdleTime'], {})
    const ns = out === undefined ? undefined : /"HIDIdleTime" = (\d+)/u.exec(out)?.[1]
    return ns === undefined ? undefined : Number(ns) / 1e6
  }
  if (platform === 'linux') {
    const out = await runDriver('gdbus', ['call', '--session', '--dest', 'org.gnome.Mutter.IdleMonitor', '--object-path', '/org/gnome/Mutter/IdleMonitor/Core', '--method', 'org.gnome.Mutter.IdleMonitor.GetIdletime'], {})
    const ms = out === undefined ? undefined : /(\d+)/u.exec(out)?.[1]
    return ms === undefined ? undefined : Number(ms)
  }
  if (platform === 'win32') {
    const out = await runDriver('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_IDLE_SCRIPT], {})
    const ms = out === undefined ? undefined : /(\d+)/u.exec(out)?.[1]
    return ms === undefined ? undefined : Number(ms)
  }
  return undefined
}

/** How often a held call re-reads the person's idle time. */
const HOLD_POLL_MS = 250

/**
 * Hold foreground driver calls while the person is using their computer.
 * Background driver input can reset the system idle timer (a background key
 * press does on macOS), so input that arrives while any driver call runs, or
 * before the last one ended, counts as the driver's own. A held call waits
 * for the person to pause and is refused only when they keep going for the
 * whole wait. An unreadable idle time never holds a call.
 * @param ctx - provider context owning the listeners.
 * @param config - the hold window and the wait; a `0` hold registers nothing.
 */
function registerForegroundHold(ctx: Context, config: Pick<Config, 'holdForegroundWhileActiveMs' | 'foregroundWaitMs'>): void {
  const holdMs = config.holdForegroundWhileActiveMs
  if (holdMs === 0) return
  let lastDriverCallEnd = 0
  let driverCallsRunning = 0
  /** Milliseconds since the person's own last input, or `undefined` when they have paused or it is unknown. */
  const personActive = async (): Promise<number | undefined> => {
    if (driverCallsRunning > 0) return undefined
    const idle = await userIdleMs(process.platform)
    if (idle === undefined || idle >= holdMs || Date.now() - idle <= lastDriverCallEnd) return undefined
    return idle
  }
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind === 'deny' || !exec.name.startsWith(DRIVER_TOOL_PREFIX)) return decision
    if (!isForegroundCall(exec.name.slice(DRIVER_TOOL_PREFIX.length), exec.arguments)) return decision
    const deadline = Date.now() + config.foregroundWaitMs
    let idle = await personActive()
    while (idle !== undefined && Date.now() < deadline && !exec.signal.aborted) {
      await new Promise(resolve => setTimeout(resolve, HOLD_POLL_MS))
      idle = await personActive()
    }
    if (idle === undefined || exec.signal.aborted) return decision
    const waited = config.foregroundWaitMs > 0 ? ` for ${Math.round(config.foregroundWaitMs / 1000)} s` : ''
    return {
      kind: 'deny',
      reason: `The person kept using their mouse or keyboard${waited} (last input ${(idle / 1000).toFixed(1)} s ago), and this call would bring a window forward or move their pointer. Do the step in the background if it allows that, or try again once they pause. If it keeps happening, ask them whether you may take over the screen for a moment.`,
    }
  })
  ctx.on('tools/execute', async (exec, next) => {
    if (!exec.name.startsWith(DRIVER_TOOL_PREFIX)) return next()
    driverCallsRunning++
    try {
      return await next()
    } finally {
      driverCallsRunning--
      lastDriverCallEnd = Date.now()
    }
  })
}

/** Upper bound on the embedded daemon opening its socket after launch. */
const DAEMON_READY_TIMEOUT_MS = 10_000

/** A daemon that exits sooner than this after launch counts as a failed start. */
const DAEMON_FAST_EXIT_MS = 5_000

/** Consecutive failed starts after which the provider stops restarting the daemon. */
const DAEMON_MAX_FAST_EXITS = 5

/** An embedded driver daemon this provider owns. */
interface EmbeddedDaemon {
  /** Private socket the MCP proxy connects through. */
  socket: string
  /** Stop restarting, terminate the daemon, and remove its socket directory. */
  stop(): Promise<void>
}

/**
 * Whether a Unix socket accepts a connection now.
 * @param path - the socket path.
 * @returns true when a connection opened.
 */
function socketAccepts(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(path)
    probe.once('connect', () => { probe.end(); resolve(true) })
    probe.once('error', () => { resolve(false) })
  })
}

/**
 * Start `serve --embedded` as a direct child, so the driver stays inside the
 * hosting application's permission identity, and wait until its private socket
 * accepts connections. A daemon that exits on its own is started again on the
 * same socket; the MCP client's reconnect finds it there.
 * @param ctx - provider context for logging.
 * @param command - the driver executable.
 * @param env - extra environment for the daemon.
 * @returns the running daemon.
 */
async function startEmbeddedDaemon(ctx: Context, command: string, env: Record<string, string>): Promise<EmbeddedDaemon> {
  const directory = mkdtempSync(join(tmpdir(), 'avn-cua-'))
  const socket = join(directory, 'driver.sock')
  let stopping = false
  let fastExits = 0
  let current!: ChildProcess
  const launch = (): void => {
    const startedAt = Date.now()
    const daemon = spawn(command, ['serve', '--embedded', '--socket', socket], { env: { ...process.env, ...env }, stdio: 'ignore' })
    current = daemon
    daemon.once('error', (error) => { ctx.logger.warn(`computer-use-cua-driver-mcp: embedded driver daemon failed to start: ${error.message}`) })
    daemon.once('exit', (code, signal) => {
      if (stopping || current !== daemon) return
      fastExits = Date.now() - startedAt < DAEMON_FAST_EXIT_MS ? fastExits + 1 : 0
      if (fastExits >= DAEMON_MAX_FAST_EXITS) {
        ctx.logger.error(`computer-use-cua-driver-mcp: embedded driver daemon exited ${fastExits} times right after starting; not restarting it`)
        return
      }
      ctx.logger.warn(`computer-use-cua-driver-mcp: embedded driver daemon exited (${String(code ?? signal)}); restarting it`)
      setTimeout(() => { if (!stopping) launch() }, 1_000).unref()
    })
  }
  const stop = async (): Promise<void> => {
    stopping = true
    const daemon = current
    if (daemon.exitCode === null && daemon.signalCode === null) {
      const exited = new Promise<void>((resolve) => { daemon.once('exit', () => { resolve() }) })
      daemon.kill('SIGTERM')
      const timer = setTimeout(() => daemon.kill('SIGKILL'), DAEMON_FAST_EXIT_MS)
      await exited
      clearTimeout(timer)
    }
    rmSync(directory, { recursive: true, force: true })
  }
  launch()
  const deadline = Date.now() + DAEMON_READY_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await socketAccepts(socket)) return { socket, stop }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await stop()
  throw new Error(`computer-use-cua-driver-mcp: embedded driver daemon did not open ${socket} within ${DAEMON_READY_TIMEOUT_MS} ms`)
}

/** The GNOME Shell extension the driver's Wayland backend needs, as upstream ships it. */
export const SHELL_HELPER_EXTENSION_ID = 'winrects@cua'

/** The helper's D-Bus name; it answers only while the extension is loaded. */
const SHELL_HELPER_BUS_NAME = 'org.cua.WinRects'

/** Runs a local command, resolving to its stdout, or `undefined` when it fails. */
export type HelperProbe = (command: string, args: string[]) => Promise<string | undefined>

/** One bounded `gdbus` call, so a wedged shell cannot stall setup. */
const probeWithGdbus: HelperProbe = (command, args) => new Promise((resolve) => {
  execFile(command, args, { timeout: 5_000 }, (error, stdout) => {
    resolve(error === null ? stdout : undefined)
  })
})

/**
 * Whether this session needs the GNOME Shell helper, and whether it answered.
 *
 * A Linux Wayland session needs it: the driver takes window geometry, desktop
 * capture and verified activation from the helper and fails closed without it,
 * because portal input is global to the compositor's focus. An X11 session, and
 * every other platform, needs nothing.
 * @param platform - the platform running the driver.
 * @param env - that machine's environment.
 * @param probe - command runner, injectable so the check is testable.
 * @returns whether the helper is required here, and whether it answered.
 */
export async function shellHelperStatus(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  probe: HelperProbe = probeWithGdbus,
): Promise<{ required: boolean; present: boolean }> {
  const required = Object.keys(driverEnv(platform, env)).length > 0
  if (!required) return { required, present: false }
  const answer = await probe('gdbus', [
    'call', '--session', '--dest', 'org.freedesktop.DBus',
    '--object-path', '/org/freedesktop/DBus',
    '--method', 'org.freedesktop.DBus.NameHasOwner', SHELL_HELPER_BUS_NAME,
  ])
  return { required, present: answer?.includes('true') === true }
}

/**
 * Reserve computer use and activate the installed Cua Driver's MCP tools.
 * With `awaitStartup` (the default), an initial connection or discovery failure rejects activation and rolls back;
 * without it, activation completes at once and the driver's tools register when it connects.
 * Disposal retains the reservation until the MCP child has finished teardown.
 * When `command` is an absolute path that does not exist, nothing is reserved
 * or spawned; the model gets only the install guidance tool.
 * @param ctx - context providing computer use and the tool registry.
 * @param config - validated executable options and optional connection overrides.
 * @returns activation completion: after initial MCP tool discovery with `awaitStartup`, at once without it.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (isAbsolute(config.command) && !existsSync(config.command)) {
    registerInstallTool(ctx, config.command)
    return
  }
  const env = {
    ...driverEnv(process.platform, process.env),
    ...settingsEnv(config),
    ...config.embedded ? { [EMBEDDED_ENV]: '1' } : {},
  }
  // A driver that does not run or prints no version falls through to the
  // MCP connection, which reports its own startup failure.
  const found = parseVersion(await runDriver(config.command, ['--version'], env) ?? '')
  const minimum = parseVersion(config.minimumVersion) as [number, number, number]
  if (found !== undefined && !versionAtLeast(found, minimum)) {
    registerUpdateTool(ctx, config.command, found.join('.'), config.minimumVersion)
    return
  }
  const connection = (socket: string | undefined): McpClient.Config => McpClient.Config({
    command: config.command,
    args: driverArgs(config, socket),
    env,
    allowedTools: config.allowedTools,
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
    reconnect: config.reconnect,
    transport: 'stdio',
    serverName: 'cua-driver-mcp',
    failOnStartupError: config.awaitStartup,
    awaitStartup: config.awaitStartup,
  })
  // One effect orders shutdown: the MCP child closes, then the embedded daemon
  // stops, then the reservation is released. Separate fiber effects unload
  // concurrently and could otherwise admit another live driver.
  if (!usesEmbeddedDaemon(config, process.platform)) {
    let child!: Fiber
    ctx.effect(function* () {
      yield ctx.computerUse.register(ComputerUseProviderName('cua-driver-mcp'))
      child = ctx.plugin(McpClient, connection(undefined))
      yield child.dispose
    }, 'computer-use-cua-driver-mcp.connection')
    await child.await()
  } else {
    const started = Promise.withResolvers<Fiber>()
    ctx.effect(async function* () {
      yield ctx.computerUse.register(ComputerUseProviderName('cua-driver-mcp'))
      let daemon: EmbeddedDaemon
      try {
        daemon = await startEmbeddedDaemon(ctx, config.command, env)
      } catch (error) {
        started.reject(error)
        return
      }
      yield () => daemon.stop()
      const child = ctx.plugin(McpClient, connection(daemon.socket))
      started.resolve(child)
      yield child.dispose
    }, 'computer-use-cua-driver-mcp.connection')
    if (config.awaitStartup) {
      await (await started.promise).await()
    } else {
      started.promise.catch((error: unknown) => {
        ctx.logger.error(`computer-use-cua-driver-mcp: driver did not start: ${error instanceof Error ? error.message : String(error)}`)
      })
    }
  }
  registerForegroundHold(ctx, config)
  registerSetupTool(ctx, config)
}

/** Model-facing name of the setup tool: the permission grant flow, or install guidance without a driver. */
const SETUP_TOOL = 'computer_use_setup'

/** Upstream installation and permissions guide for the driver. */
const INSTALL_GUIDE = 'https://github.com/trycua/cua/blob/cua-driver-rs-v0.45.2/libs/cua-driver/README.md'

/**
 * Register a setup tool that only explains why computer use is unavailable, so
 * the capability stays discoverable and the model can tell the person what to do.
 * @param ctx - provider context owning the tool.
 * @param reason - why computer use is unavailable, completing "is unavailable: …".
 * @param remedy - the verb the description offers ("enable", "update").
 * @param guidance - the tool's result: what the person has to do.
 * @param label - effect label for diagnostics.
 */
function registerGuidanceTool(ctx: Context, reason: string, remedy: string, guidance: string, label: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: SETUP_TOOL,
    description: `Computer use (operating apps on this computer by seeing the screen, clicking, and typing) is unavailable: ${reason}. Call this when the person asks you to operate an app on their computer or asks about computer use, to learn how they can ${remedy} it.`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: (_args, exec) => {
      exec.signal.throwIfAborted()
      return Promise.resolve(guidance)
    },
    presentCall: () => ({ card: 'generic', title: 'Set up computer use', kind: 'read' }),
  })), label)
}

/**
 * Register the setup tool for a machine without the driver.
 * @param ctx - provider context owning the tool.
 * @param command - the absolute driver path that was not found.
 */
function registerInstallTool(ctx: Context, command: string): void {
  registerGuidanceTool(ctx, 'it needs Cua Driver, which is not installed', 'enable',
    `Computer use needs Cua Driver, which is not installed: ${command} does not exist. Tell the person to install it by following ${INSTALL_GUIDE}, then restart Aeven. After the restart this tool completes the setup computer use needs.`,
    'computer-use-cua-driver-mcp.install-tool')
}

/**
 * Register the setup tool for a driver older than this provider accepts, so the
 * model tells the person how to update it instead of calling missing tools.
 * @param ctx - provider context owning the tool.
 * @param command - the driver executable that reported the old version.
 * @param found - the installed version.
 * @param minimum - the oldest accepted version.
 */
function registerUpdateTool(ctx: Context, command: string, found: string, minimum: string): void {
  registerGuidanceTool(ctx, 'the installed Cua Driver is too old', 'update',
    `Computer use needs Cua Driver ${minimum} or newer, and ${command} is version ${found}. Tell the person to update it by running "${command}" update --apply in a terminal, then restart Aeven.`,
    'computer-use-cua-driver-mcp.update-tool')
}

/**
 * Model-facing setup result for a platform without permission prompts.
 * @param session - what this session already has.
 * @param findings - the driver's failing or warning probes.
 * @returns the session state followed by what to fix, or a retry hint when nothing failed.
 */
function withFindings(session: string, findings: readonly string[]): string {
  if (findings.length === 0) return `${session} The driver's own checks all pass. Report what failed and retry that tool.`
  return `${session} The driver's own checks found:\n${findings.map(line => `- ${line}`).join('\n')}\nTell the person what to fix in plain words, then retry after they confirm.`
}

/** One probe from `cua-driver doctor --json`. */
interface DoctorProbe {
  label: string
  message: string
  status: string
}

/**
 * The driver's own diagnosis of this machine: every probe that is not `ok`.
 * @param command - the driver executable.
 * @param env - the environment the driver runs with.
 * @returns one line per failing or warning probe; empty when all pass or the report is unreadable.
 */
async function doctorFindings(command: string, env: Record<string, string>): Promise<string[]> {
  const stdout = await runDriver(command, ['doctor', '--json'], env)
  if (stdout === undefined) return []
  let report: unknown
  try {
    report = JSON.parse(stdout)
  } catch {
    // A report that is not JSON gives no findings; the caller still returns its own advice.
    return []
  }
  if (typeof report !== 'object' || report === null || !('probes' in report) || !Array.isArray(report.probes)) return []
  return (report.probes as unknown[])
    .filter((probe): probe is DoctorProbe => typeof probe === 'object' && probe !== null
      && typeof (probe as DoctorProbe).label === 'string' && typeof (probe as DoctorProbe).message === 'string'
      && typeof (probe as DoctorProbe).status === 'string')
    .filter(probe => probe.status !== 'ok')
    .map(probe => `${probe.status}: ${probe.label}: ${probe.message}`)
}

/**
 * The driver's own grant flow: it launches CuaDriver through LaunchServices so
 * macOS attributes the Accessibility and Screen Recording requests to that
 * app, shows its dialogs, and opens the matching System Settings panes.
 */
const GRANT_ARGS = ['permissions', 'grant']

/**
 * JXA that requests Accessibility and Screen Recording for the application at
 * the top of this process's launch chain, which is where an embedded driver's
 * permission checks land. macOS shows its own dialog for each missing grant
 * and lists the application in System Settings. Prints the two current grants
 * as JSON.
 */
const HOST_GRANT_SCRIPT = [
  'ObjC.import("ApplicationServices")',
  'ObjC.import("CoreGraphics")',
  'ObjC.bindFunction("CGPreflightScreenCaptureAccess", ["bool", []])',
  'ObjC.bindFunction("CGRequestScreenCaptureAccess", ["bool", []])',
  'const accessibility = $.AXIsProcessTrustedWithOptions($({ AXTrustedCheckOptionPrompt: true }))',
  'const screenRecording = $.CGPreflightScreenCaptureAccess() || $.CGRequestScreenCaptureAccess()',
  'JSON.stringify({ accessibility, screenRecording })',
].join('\n')

/** Current macOS grants of the application hosting an embedded driver. */
interface HostGrants {
  accessibility: boolean
  screenRecording: boolean
}

/**
 * Request the host application's missing grants through `osascript`, which
 * runs inside the host's launch chain, so macOS names the host application.
 * @param signal - aborts the request with the tool call.
 * @returns the grants after the request; a dialog the person has not answered counts as missing.
 */
function requestHostGrants(signal: AbortSignal): Promise<HostGrants> {
  return new Promise((resolve, reject) => {
    execFile('/usr/bin/osascript', ['-l', 'JavaScript', '-e', HOST_GRANT_SCRIPT], { signal, timeout: 30_000 }, (error, stdout) => {
      if (error !== null) {
        // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- the callback's ExecFileException extends Error
        reject(error)
        return
      }
      let grants: unknown
      try {
        grants = JSON.parse(stdout)
      } catch {
        // Output that is not JSON falls through to the shape check below.
      }
      if (typeof grants !== 'object' || grants === null
        || !('accessibility' in grants) || typeof grants.accessibility !== 'boolean'
        || !('screenRecording' in grants) || typeof grants.screenRecording !== 'boolean') {
        reject(new Error(`osascript reported unexpected grants: ${stdout.trim()}`))
        return
      }
      resolve({ accessibility: grants.accessibility, screenRecording: grants.screenRecording })
    })
  })
}

/**
 * Model-facing result of a host grant request.
 * @param grants - the host application's grants after the request.
 * @returns what the model tells the person next.
 */
function hostGrantResult(grants: HostGrants): string {
  if (grants.accessibility && grants.screenRecording) {
    return 'Aeven has Accessibility and Screen Recording, so computer use is allowed. If a computer-use tool still reports a missing permission, the driver started before the grant: ask the person to quit and reopen Aeven, then retry.'
  }
  const missing = [
    ...grants.accessibility ? [] : ['Accessibility'],
    ...grants.screenRecording ? [] : ['Screen Recording'],
  ].join(' and ')
  return `macOS is asking for permission now. Tell the person to switch on Aeven under ${missing} in System Settings > Privacy & Security, then to quit and reopen Aeven when macOS asks, because the change applies after a restart. After the restart, check again with check_permissions and prompt false.`
}

/**
 * Register the tool that completes the permissions computer use needs. Every
 * call asks the person first on macOS, in any sandbox mode, because the
 * request raises system dialogs on their screen. A standalone driver runs its
 * own grant flow for CuaDriver; an embedded driver's grants belong to the host
 * application, so the tool requests them for that application.
 * @param ctx - provider context owning the tool and any running grant flow.
 * @param config - the driver executable and whether it runs embedded.
 */
function registerSetupTool(ctx: Context, config: Config): void {
  const grantee = config.embedded ? 'Aeven' : 'CuaDriver'
  const driverEnvironment = { ...driverEnv(process.platform, process.env), ...settingsEnv(config) }
  let running: ChildProcess | undefined
  ctx.effect(() => () => {
    // A grant flow still waiting on the person ends with the provider.
    running?.kill()
    running = undefined
  }, 'computer-use-cua-driver-mcp.setup-process')
  if (process.platform === 'darwin') {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || exec.name !== SETUP_TOOL) return decision
      return {
        kind: 'ask',
        reason: `Allow Aeven to set up computer use? macOS will ask you to let ${grantee} use Accessibility and Screen Recording, and lists it in System Settings where you switch it on.`,
      }
    })
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: SETUP_TOOL,
    description: `Set up computer use on this computer. Call it only when mcp__cua-driver-mcp__check_permissions with prompt false reports a missing permission, when a computer-use tool fails, or when the person asks how to enable computer use. On macOS it asks for the permissions computer use needs: the person approves first, macOS then shows its own dialogs and lists ${grantee} in System Settings, where they switch it on — tell them what to switch on, wait for them to say they are done, then check again with prompt false. On Linux it reports whether this session needs the GNOME Shell helper and whether it is loaded, because the driver refuses input on Wayland without it. On Linux and Windows it also runs the driver's own checks and reports any that fail, such as desktop accessibility being off or the driver running outside the person's desktop session.`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      if (process.platform === 'linux') {
        const helper = await shellHelperStatus(process.platform, process.env)
        if (helper.required && !helper.present) {
          const install = config.embedded
            ? `run ${join(dirname(config.command), 'wayland-helper', 'install.sh')}, which installs and enables it,`
            : `install the extension from ${INSTALL_GUIDE},`
          return `Computer use needs the GNOME Shell helper on Wayland, and ${SHELL_HELPER_EXTENSION_ID} is not loaded, so the driver refuses to type into an unknown window. Tell the person to ${install} then to log out and back in once so the shell loads it.`
        }
        const session = helper.required
          ? `This Wayland session has the ${SHELL_HELPER_EXTENSION_ID} Shell helper loaded.`
          : 'This Linux session runs X11, where the driver needs no Shell helper.'
        return withFindings(session, await doctorFindings(config.command, driverEnvironment))
      }
      if (process.platform === 'win32') {
        return withFindings('Windows asks for no permission for computer use; the driver needs the signed-in person\'s interactive desktop, not a service session.', await doctorFindings(config.command, driverEnvironment))
      }
      if (config.embedded) {
        return hostGrantResult(await requestHostGrants(exec.signal))
      }
      if (running !== undefined && running.exitCode === null) {
        return 'The macOS permission request is already open. Ask the person to finish it in System Settings.'
      }
      const grant = spawn(config.command, GRANT_ARGS, { stdio: 'ignore' })
      await new Promise<void>((resolve, reject) => {
        grant.once('spawn', resolve)
        grant.once('error', reject)
      })
      running = grant
      grant.once('exit', () => { if (running === grant) running = undefined })
      return 'macOS is asking for permission now. Tell the person to allow CuaDriver for Accessibility and for Screen Recording in the dialogs or in System Settings, then to tell you when they are done.'
    },
    presentCall: () => ({ card: 'generic', title: 'Set up computer use', kind: 'execute' }),
  })), 'computer-use-cua-driver-mcp.setup-tool')
}
