/**
 * Exclusive computer use through an installed Cua Driver MCP executable.
 * The MCP client owns discovery, execution, image admission, and reconnection.
 * @module
 */

import { spawn, type ChildProcess } from 'node:child_process'
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
  /** Per-call timeout in milliseconds; omission uses the MCP client's default. */
  toolCallTimeoutMs?: number
  /** Reconnection overrides; defaults to the MCP client's policy. */
  reconnect: McpClient.ReconnectConfig
}

/** Validate executable options; the MCP client resolves connection defaults. */
export const Config: z<Partial<Config>, Config> = z.object({
  command: z.string().pattern(/[^\s]/u).default('cua-driver'),
  args: z.array(String).default(['mcp']),
  toolCallTimeoutMs: z.number().min(1),
  reconnect: z.object({
    enabled: z.boolean(),
    initialDelayMs: z.number().min(1),
    maxDelayMs: z.number().min(1),
    maxAttempts: z.number().min(1).step(1),
  }),
})

/**
 * Reserve computer use and activate the installed Cua Driver's MCP tools.
 * Initial connection or discovery failure rejects activation and rolls back.
 * Disposal retains the reservation until the MCP child has finished teardown.
 * @param ctx - context providing computer use and the tool registry.
 * @param config - validated executable options and optional connection overrides.
 * @returns initial MCP tool-discovery completion.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const connection = McpClient.Config({
    command: config.command,
    args: config.args,
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
  registerSetupTool(ctx, config.command)
}

/** Model-facing name of the permission setup tool. */
const SETUP_TOOL = 'computer_use_setup'

/**
 * The driver's own grant flow: it launches CuaDriver through LaunchServices so
 * macOS attributes the Accessibility and Screen Recording requests to that
 * app, shows its dialogs, and opens the matching System Settings panes.
 */
const GRANT_ARGS = ['permissions', 'grant']

/**
 * Register the tool that starts the driver's permission grant flow. Every call
 * asks the person first, in any sandbox mode, because the flow raises system
 * dialogs on their screen; the driver reserves prompting to a trusted host
 * route, which this approved call is.
 * @param ctx - provider context owning the tool and any running grant flow.
 * @param command - the installed driver executable.
 */
function registerSetupTool(ctx: Context, command: string): void {
  let running: ChildProcess | undefined
  ctx.effect(() => () => {
    // A grant flow still waiting on the person ends with the provider.
    running?.kill()
    running = undefined
  }, 'computer-use-cua-driver-mcp.setup-process')
  ctx.on('tools/pre-execute', async (exec, next) => {
    const decision = await next()
    if (decision.kind !== 'allow' || exec.name !== SETUP_TOOL) return decision
    return {
      kind: 'ask',
      reason: 'Allow Aeven to set up computer use? macOS will ask you to let CuaDriver use Accessibility and Screen Recording, and opens System Settings where you switch it on.',
    }
  })
  ctx.effect(() => ctx.tools.register(defineTool({
    name: SETUP_TOOL,
    description: 'Ask macOS for the permissions computer use needs. Call it only when mcp__cua-driver-mcp__check_permissions with prompt false reports Accessibility or Screen Recording as missing, or a computer-use tool fails for a missing permission. The person approves first; macOS then shows its own dialogs and opens System Settings, where they switch on CuaDriver. Tell them what to switch on, wait for them to say they are done, then check again with prompt false.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: (_args, value) => [{ type: 'text', text: value }],
    },
    async execute(_args, exec) {
      exec.signal.throwIfAborted()
      if (running !== undefined && running.exitCode === null) {
        return 'The macOS permission request is already open. Ask the person to finish it in System Settings.'
      }
      const grant = spawn(command, GRANT_ARGS, { stdio: 'ignore' })
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
