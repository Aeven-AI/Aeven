/**
 * The model-facing `elevated` tool: run one command as administrator on Windows.
 *
 * The human decides twice: the harness approval this tool asks through
 * `ctx.approval` before anything spawns, and the operating system's consent
 * prompt after it. A rejected approval or a dismissed prompt fails the call;
 * the command is never run at the caller's own privilege instead. The tool is
 * registered only on Windows, so no other host offers a call it cannot serve.
 *
 * @module @aeven/tool-elevation
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { HarnessError } from '@aeven/llm'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/subprocess'
import type {} from '@aeven/user-approval'
import { runElevated, type ElevatedShell } from './run.ts'

export { launcherScript, runElevated, type ElevatedResult, type ElevatedRun, type ElevatedShell } from './run.ts'

/** Stable Cordis plugin name. */
export const name = 'tool-elevation'

/** Tool registration, the consent channel, and the spawn seam. */
export const inject = ['tools', 'approval', 'subprocess']

/** Tool configuration. */
export interface Config {
  /** Default and maximum deadline for one elevated run, in ms. */
  timeoutMs?: number
  /** Retained tail of the captured output, in characters. */
  maxOutputChars?: number
}

/** Schemastery validation for {@link Config}. */
export const Config: z<Config> = z.object({
  timeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(600_000),
  maxOutputChars: z.natural().min(1).default(100_000),
})

const SHELLS: readonly ElevatedShell[] = ['powershell', 'cmd']

/**
 * Register the `elevated` tool on Windows hosts.
 * @param ctx - the plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  if (process.platform !== 'win32') return
  // schemastery's .default() guarantees both fields after validation.
  const maxTimeoutMs = config.timeoutMs as number
  const maxOutputChars = config.maxOutputChars as number

  ctx.tools.register(defineTool({
    name: 'elevated',
    description: 'Run one command as administrator through the Windows user-account-control prompt. '
      + 'The user approves the run in Aeven and then again in the Windows prompt, so it always interrupts them: use it only '
      + 'when the task needs machine-wide authority (installing a service, writing under a protected directory, changing '
      + 'a machine setting), and prefer a per-user equivalent when one exists. Returns the exit code and captured output. '
      + 'A refusal at either prompt fails the call; the command is never run unprivileged instead.',
    parameters: {
      shell: {
        type: 'string' as const,
        required: true,
        enum: [...SHELLS],
        description: '"powershell" for a PowerShell command, "cmd" for a Command Prompt command.',
      },
      command: {
        type: 'string' as const,
        required: true,
        description: 'The exact command text to run; multiple lines run as one script.',
      },
      justification: {
        type: 'string' as const,
        required: true,
        description: 'One sentence, shown to the user, explaining why this command needs administrator rights.',
      },
      timeoutMs: {
        type: 'number' as const,
        description: `Deadline in milliseconds, at most ${String(maxTimeoutMs)} (the default).`,
      },
    },
    output: {
      schema: { type: 'string' },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    },
    async execute(args, exec) {
      const shell = args.shell
      if (!SHELLS.includes(shell)) throw new Error('invalid shell: expected "powershell" or "cmd"')
      if (typeof args.command !== 'string' || args.command.trim() === '') throw new Error('invalid command: expected a non-empty command')
      const justification = typeof args.justification === 'string' ? args.justification.trim() : ''
      if (justification === '') throw new Error('invalid justification: expected a non-empty sentence')
      if (exec.agent === undefined) throw new HarnessError('running as administrator needs an agent to ask the user through', 'ELEVATION_DENIED')

      const outcome = await ctx.approval.request({
        agent: exec.agent,
        toolName: exec.name,
        callId: exec.callId,
        signal: exec.signal,
        reason: `Run as administrator (${shell}): ${justification}`,
        // The grant covers this widening only; a sandbox grant never authorizes it.
        allowSession: 'privilege:standard->administrator',
        allowSessionCoverage: 'privilege',
      })
      if (outcome !== 'allowed-once') throw new HarnessError(`running as administrator was not approved (${outcome})`, 'ELEVATION_DENIED')

      const requested = typeof args.timeoutMs === 'number' && args.timeoutMs >= 1 ? args.timeoutMs : maxTimeoutMs
      const result = await runElevated(ctx.subprocess, {
        shell,
        command: args.command,
        timeoutMs: Math.min(requested, maxTimeoutMs),
        maxOutputChars,
        signal: exec.signal,
      })
      return JSON.stringify(result, null, 2)
    },
  }))
}
