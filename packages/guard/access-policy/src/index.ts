/**
 * Tool-call access policy: while the session's access mode forbids effects, deny the tools whose
 * effects do not pass through the filesystem sandbox.
 *
 * The filesystem sandbox already refuses every write that routes through the fs capability, so a
 * `read-only` session cannot edit a file. Tools that act on a live browser page, run a terminal
 * command, or boot a device never reach that layer, which leaves those routes open. This plugin
 * closes them with a monotonic `tools.guard()` check: the denial names the tool, the mode, and what
 * authorizes the call, so the model can ask rather than retry.
 *
 * A recalled memory never reaches this policy. It reads the session's access mode and the
 * deployment's own tool list, both owned by the user.
 *
 * @module @aeven/tool-call-access-policy
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { ToolExecution } from '@aeven/tools'
import type { SandboxMode } from '@aeven/sandbox'
import type {} from '@aeven/sandbox-policy'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'access-policy'

/** The tool registry this plugin guards and the session access mode it reads. */
export const inject = ['tools', 'sandboxPolicy']

/**
 * Tools whose effects bypass the filesystem sandbox: they act on a live browser page, run a
 * command in a terminal session, or power a device on and off.
 */
export const DEFAULT_EFFECT_TOOLS: readonly string[] = [
  'preview_upload',
  'preview_sequence',
  'preview_click',
  'preview_type',
  'preview_press',
  'preview_evaluate',
  'preview_navigate',
  'preview_back',
  'preview_forward',
  'preview_reload',
  'terminal_open',
  'terminal_send',
  'terminal_signal',
  'terminal_close',
  'device_open',
  'device_close',
]

/**
 * Plugin config, validated by the same-named schemastery schema plus the declared interface.
 * Deployments narrow or extend `deny` from `cordis.yml`; an empty list disables the policy.
 */
export interface Config {
  /** Access mode in which the listed tools are denied. */
  mode: SandboxMode
  /** Tool names denied while the session's access mode equals `mode`. */
  deny: string[]
}

/** Validated schema for {@link Config}. */
export const Config: z<Config> = z.object({
  mode: z.union([z.const('read-only'), z.const('workspace-write'), z.const('danger-full-access')]).default('read-only'),
  deny: z.array(z.string()).default([...DEFAULT_EFFECT_TOOLS]),
})

/**
 * Register the denial check. The guard is synchronous and reads the already-resolved session
 * policy, so it adds no request, no provider call, and no tokens to a turn.
 * @param ctx - Host context carrying the tool registry and the session access policy.
 * @param config - validated consumer configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const denied = new Set(config.deny)
  ctx.effect(() => ctx.tools.guard((exec: ToolExecution) => {
    if (!denied.has(exec.name)) return undefined
    if (ctx.sandboxPolicy.resolve().mode !== config.mode) return undefined
    return `${exec.name} acts outside the filesystem sandbox, which this session's "${config.mode}" access mode forbids; ask the user to raise the access mode to continue`
  }), 'access-policy.guard')
}
