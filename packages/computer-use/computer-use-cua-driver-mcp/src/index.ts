/**
 * Exclusive computer use through an installed or host-shipped Cua Driver MCP executable.
 * The MCP client owns discovery, execution, image admission, and reconnection.
 * An absolute `command` that does not exist registers only an install tool.
 * @module
 */

import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
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
   * Defaults to `false`.
   */
  embedded: boolean
  /** Per-call timeout in milliseconds; omission uses the MCP client's default. */
  toolCallTimeoutMs?: number
  /** Reconnection overrides; defaults to the MCP client's policy. */
  reconnect: McpClient.ReconnectConfig
}

/** Validate executable options; the MCP client resolves connection defaults. */
export const Config: z<Partial<Config>, Config> = z.object({
  command: z.string().pattern(/[^\s]/u).default('cua-driver'),
  args: z.array(String).default(['mcp']),
  embedded: z.boolean().default(false),
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
 * The MCP child's arguments. An embedded driver needs `--direct`: without it
 * the driver requires a host-started daemon socket instead of owning the
 * runtime in the child the host spawned. On macOS a direct runtime has no
 * agent-cursor overlay.
 * @param config - validated executable options.
 * @returns arguments for the MCP child.
 */
export function driverArgs(config: Pick<Config, 'args' | 'embedded'>): string[] {
  return config.embedded ? [...config.args, '--embedded', '--direct'] : config.args
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
 * Initial connection or discovery failure rejects activation and rolls back.
 * Disposal retains the reservation until the MCP child has finished teardown.
 * When `command` is an absolute path that does not exist, nothing is reserved
 * or spawned; the model gets only the install guidance tool.
 * @param ctx - context providing computer use and the tool registry.
 * @param config - validated executable options and optional connection overrides.
 * @returns initial MCP tool-discovery completion.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (isAbsolute(config.command) && !existsSync(config.command)) {
    registerInstallTool(ctx, config.command)
    return
  }
  const connection = McpClient.Config({
    command: config.command,
    args: driverArgs(config),
    env: {
      ...driverEnv(process.platform, process.env),
      ...config.embedded ? { [EMBEDDED_ENV]: '1' } : {},
    },
    ...config.toolCallTimeoutMs === undefined ? {} : { toolCallTimeoutMs: config.toolCallTimeoutMs },
    reconnect: config.reconnect,
    transport: 'stdio',
    serverName: 'cua-driver-mcp',
    failOnStartupError: true,
  })
  // One effect orders child shutdown before release; separate fiber effects
  // unload concurrently and could otherwise admit another live driver.
  let child!: Fiber
  ctx.effect(function* () {
    yield ctx.computerUse.register(ComputerUseProviderName('cua-driver-mcp'))
    child = ctx.plugin(McpClient, connection)
    yield child.dispose
  }, 'computer-use-cua-driver-mcp.connection')
  await child.await()
  registerSetupTool(ctx, config)
}

/** Model-facing name of the setup tool: the permission grant flow, or install guidance without a driver. */
const SETUP_TOOL = 'computer_use_setup'

/** Upstream installation and permissions guide for the driver. */
const INSTALL_GUIDE = 'https://github.com/trycua/cua/blob/cua-driver-rs-v0.35.4/libs/cua-driver/README.md'

/**
 * Register the setup tool for a machine without the driver, so the capability
 * is discoverable and the model can tell the person how to enable it.
 * @param ctx - provider context owning the tool.
 * @param command - the absolute driver path that was not found.
 */
function registerInstallTool(ctx: Context, command: string): void {
  ctx.effect(() => ctx.tools.register(defineTool({
    name: SETUP_TOOL,
    description: 'Computer use (operating apps on this computer by seeing the screen, clicking, and typing) is unavailable: it needs Cua Driver, which is not installed. Call this when the person asks you to operate an app on their computer or asks about computer use, to learn how they can enable it.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    execute: async (_args, exec) => {
      exec.signal.throwIfAborted()
      return `Computer use needs Cua Driver, which is not installed: ${command} does not exist. Tell the person to install it by following ${INSTALL_GUIDE}, then restart Aeven. After the restart this tool completes the setup computer use needs.`
    },
    presentCall: () => ({ card: 'generic', title: 'Set up computer use', kind: 'read' }),
  })), 'computer-use-cua-driver-mcp.install-tool')
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
    description: `Set up computer use on this computer. Call it only when mcp__cua-driver-mcp__check_permissions with prompt false reports a missing permission, when a computer-use tool fails, or when the person asks how to enable computer use. On macOS it asks for the permissions computer use needs: the person approves first, macOS then shows its own dialogs and lists ${grantee} in System Settings, where they switch it on — tell them what to switch on, wait for them to say they are done, then check again with prompt false. On Linux it reports whether this session needs the GNOME Shell helper and whether it is loaded, because the driver refuses input on Wayland without it.`,
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      if (process.platform === 'linux') {
        const helper = await shellHelperStatus(process.platform, process.env)
        if (!helper.required) {
          return 'This Linux session runs X11, where the driver needs no extra setup. Report what failed and retry that tool.'
        }
        if (helper.present) {
          return `Computer use is set up on this Wayland session: the ${SHELL_HELPER_EXTENSION_ID} Shell helper is loaded, so the driver can see the desktop and act on it. Report what failed and retry that tool.`
        }
        const install = config.embedded
          ? `run ${join(dirname(config.command), 'wayland-helper', 'install.sh')}, which installs and enables it,`
          : `install the extension from ${INSTALL_GUIDE},`
        return `Computer use needs the GNOME Shell helper on Wayland, and ${SHELL_HELPER_EXTENSION_ID} is not loaded, so the driver refuses to type into an unknown window. Tell the person to ${install} then to log out and back in once so the shell loads it.`
      }
      if (config.embedded) {
        if (process.platform !== 'darwin') {
          return 'This system needs no permission setup for computer use. Report what failed and retry that tool.'
        }
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
