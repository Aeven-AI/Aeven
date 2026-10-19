/**
 * Model-facing PowerShell Consumer of the `ctx.shell` capability seam. Intended for
 * Windows compositions where a PowerShell executor (e.g.
 * `@aeven/pwsh-local`) backs `ctx.shell`; the tool contract is
 * PowerShell-dialect: native `C:\...` paths and `$env:NAME` variables.
 *
 * Behavior mirrors `avn-tool-bash` call-for-call: foreground and
 * `run_in_background` execution (background handles register with the
 * generic `ctx.jobs` runtime), the managed `AVN_*` environment through the
 * shared `shell-env` registry, the per-call sandbox policy resolution (the
 * calling session's mode and cwd travel to the confining executor), the
 * sandbox-denial rendering with the same-turn escalation surface
 * (`sandbox_permissions` + `justification` resolved through
 * `ctx.approval`), and the bash marker/truncation rendering story. UI
 * presentation mirrors the bash tool's too: a completed foreground call is
 * a terminal card with the parsed exit-status pill, using the shared
 * exit-status parse from `@aeven/shell`.
 *
 * @module @aeven/tool-pwsh
 */

import { isAbsolute, resolve as resolvePath } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool, TOOL_ABORTED } from '@aeven/tools'
import type { GenericCallView, TerminalCallView, ToolExecution, ToolResult, ToolResultView } from '@aeven/tools'
import { HarnessError } from '@aeven/llm'
import type { Agent } from '@aeven/agent'
import type { JobId, JobRegistry } from '@aeven/jobs'
import type {} from '@aeven/shell-env'
import type {} from '@aeven/user-approval'
import type { SandboxExecutionPolicy, SandboxMode } from '@aeven/sandbox'
import { ESCALATION_TARGETS, approveEscalation, validateEscalationArgs } from '@aeven/sandbox'
import type { SandboxPolicyService } from '@aeven/sandbox-policy'
import type { ShellProcess, ShellRunResult } from '@aeven/shell'
import { isDetachedRun, parseExitStatus } from '@aeven/shell'
import { processOutcome, processSources } from './background.ts'
import { BACKGROUND_ACK, renderPwshResult } from './render.ts'
import type { RenderablePwshResult } from './render.ts'

declare module '@aeven/jobs' {
  interface JobKindMap {
    pwsh: 'pwsh'
  }
}

export const name = 'tool-pwsh'
export const inject = ['tools', 'shell', 'systemPrompt', 'shellEnv']

/** Default foreground budget before a still-running command is handed to a background job. */
const DEFAULT_DETACH_AFTER_MS = 20_000

/** Configuration for the pwsh tool. */
export interface Config {
  /** Expose `run_in_background` (default true); disabled calls are also rejected. */
  enableRunInBackground?: boolean
  /**
   * How long a foreground command may run before the tool hands it back as a
   * background job (default 20000). Applies only when `run_in_background` is
   * available and a job runtime is mounted; without one, foreground calls wait.
   */
  detachAfterMs?: number
}

/** Runtime configuration schema for the pwsh tool plugin. */
export const Config: z<Config> = z.object({
  enableRunInBackground: z.boolean().default(true),
  detachAfterMs: z.number().default(DEFAULT_DETACH_AFTER_MS),
})

/** Parsed tool args; execute validates value constraints absent from ParameterSchemaSpec. */
interface PwshToolArgs {
  command: string
  description: string
  timeoutMs?: number
  workdir?: string
  run_in_background?: boolean
  sandbox_permissions?: string
  justification?: string
}

/** The canonical foreground result of one pwsh call (the `output.schema` value shape). */
interface PwshForegroundResult {
  kind: 'foreground'
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
  timeoutMs: number
  stdout: { text: string; truncated: boolean; spillPath?: string }
  stderr: { text: string; truncated: boolean; spillPath?: string }
  sandbox?: { mode: string; denied: boolean; enforcement?: string; runnerFailed?: boolean }
}

/* jscpd:ignore-start -- minimal mirror of avn-tool-bash's validation and execute plumbing (Agent Note). */
function validatePwshArgs(args: PwshToolArgs): void {
  if (args.command.trim().length === 0) {
    throw new Error('invalid command: expected a non-empty string')
  }
  if (args.description.trim().length === 0) {
    throw new Error('invalid description: expected a non-empty string')
  }
  if (args.timeoutMs !== undefined && (!Number.isFinite(args.timeoutMs) || args.timeoutMs <= 0)) {
    throw new Error(`invalid timeoutMs: expected a positive number, got ${JSON.stringify(args.timeoutMs)}`)
  }
  // The escalation pairing (sandbox_permissions ⇔ justification, non-empty) is
  // the shared rule both enforcing families validate identically.
  validateEscalationArgs(args.sandbox_permissions, args.justification)
}
/* jscpd:ignore-end */

function pwshDescription(
  backgroundEnabled: boolean,
  detachAfterMs: number | undefined,
  escalationModes: readonly SandboxMode[],
): string {
  const background = !backgroundEnabled
    ? 'Background execution is not available; long-running commands must finish within the timeout.'
    : detachAfterMs === undefined
      ? 'Start long-running commands with `run_in_background: true`: the call returns a job id immediately; read its output with `job_output` and stop it with `job_kill`.'
      : `Start anything whose duration you cannot bound in the background with \`run_in_background: true\` — installs, builds, test suites, servers, downloads — so \`job_output\` collects it while you keep working. A foreground command still running after ${detachAfterMs}ms is handed back as a background job instead of blocking the turn.`
  const base = 'Execute a PowerShell command (`pwsh -Command`) and return its stdout/stderr. '
    + 'Each call runs in a fresh pwsh process: no state (cwd, variables, functions) persists between calls — '
    + 'pass `workdir` instead of using `cd`. Paths use native Windows form (`C:\\...`); read environment '
    + 'variables with `$env:NAME`. Non-zero exits are reported as `[exit code: N]`. '
    + 'Current harness environment facts are exposed through managed `$env:AVN_*` variables; inspect them when needed. '
    + 'Commands may run under a file sandbox; a blocked file operation is reported as `[sandbox: file access denied under <mode> mode]` — a policy denial, not a bug in the command; do not retry another way. '
    + 'Long output is truncated to its tail; the full output is saved to a file whose path is reported when available. '
    + 'On Windows a force-killed command settles as `[exit code: 1]` without a signal marker — treat it as an interruption, not a command failure. '
    + background
  if (escalationModes.length === 0) return base
  // The language-mode and named-pipe contracts below are Windows-restricted-token
  // behavior, but the gate is 'any confining executor is mounted'
  // (escalationModes non-empty). Every shipped composition pairing tool-pwsh
  // with a confining executor is win32-only, so the gate is equivalent. A POSIX
  // pwsh-sandbox composition must gate both sentences on the platform instead
  // (tracked in the pwsh-tool-and-executor Agent Note).
  return base + ' Under the Windows sandbox, read-only pwsh runs in PowerShell ConstrainedLanguage mode, while '
    + 'workspace-write stays in FullLanguage unless host policy says otherwise. In read-only, prefer cmdlets and core types (`[string]`, `[datetime]`, `[regex]`, `[guid]`); '
    + '.NET static calls (`[System.IO.*]::`, `[math]::`), `Add-Type`, COM objects, and reflection fail '
    + 'with "only core types" errors. `-f` formatting, property access, and core cmdlets work. '
    + 'In both confined modes, programs cannot open named pipes, so a command that captures another '
    + 'program\'s output through piped stdio (Node.js `child_process.spawn`/`exec` with the default '
    + '`stdio: \'pipe\'`) fails with EPERM, while `stdio: \'inherit\'` and `stdio: \'ignore\'` spawns '
    + 'work and PowerShell\'s own pipelines are unaffected. That EPERM is the documented boundary: '
    + 'do not retry the command another way — escalate the exact command once or restructure it to '
    + 'avoid capturing output. '
    + 'Attempting a command the sandbox may deny is safe and expected: run it and read the '
    + 'marker rather than assuming the denial. When a command is denied and a wider mode would let it '
    + 'succeed, escalate immediately in the same turn — the one sanctioned exception to a denial: retry '
    + 'the exact same command once with `sandbox_permissions` (the narrowest wider mode that suffices) '
    + 'plus a one-sentence `justification`. Do not detour through chat to ask permission first — the '
    + 'approval prompt raised by that retry is how the user consents. If the session states approval '
    + 'prompts are disabled, there is no exception: a denial is final — do not set `sandbox_permissions`. '
    + 'Never escalate speculatively: ground the request in a real denial — normally the one this command '
    + 'just hit; escalating up front is fine only when this session already denied the same access. '
    + 'A rejected escalation is final for that command — stop and explain, never work around '
    + 'it — but it does not forbid attempting or escalating other commands later.'
}

/**
 * Resolve an explicit workdir first, making a relative one session-workspace-relative;
 * otherwise use the session header cwd and leave executor defaulting as the fallback.
 */
function resolveWorkdir(modelWorkdir: string | undefined, exec: { agent?: Agent }): string | undefined {
  const headerCwd = exec.agent?.session.header.cwd
  if (modelWorkdir === undefined) return headerCwd
  if (headerCwd !== undefined && !isAbsolute(modelWorkdir)) {
    return resolvePath(headerCwd, modelWorkdir)
  }
  return modelWorkdir
}

/** Detach the executor DTO from readonly Service Definition types into plain JSON data. */
function canonicalPwshResult(result: ShellRunResult): PwshForegroundResult {
  const output = (stream: ShellRunResult['stdout']) => ({
    text: stream.text,
    truncated: stream.truncated,
    ...stream.spillPath !== undefined ? { spillPath: stream.spillPath } : {},
  })
  return {
    kind: 'foreground',
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    aborted: result.aborted,
    timeoutMs: result.timeoutMs,
    /* jscpd:ignore-start -- the canonical projection and background-handle shape mirror avn-tool-bash's by design (Agent Note). */
    stdout: output(result.stdout),
    stderr: output(result.stderr),
    ...result.sandbox !== undefined ? {
      sandbox: {
        mode: result.sandbox.mode,
        denied: result.sandbox.denied,
        ...result.sandbox.enforcement !== undefined ? { enforcement: result.sandbox.enforcement } : {},
        ...result.sandbox.runnerFailed !== undefined ? { runnerFailed: result.sandbox.runnerFailed } : {},
      },
    } : {},
  }
}

/**
 * Settle a run that stayed in the foreground: an aborted call is a harness
 * abort rather than a command result.
 * @param result - the settled foreground run.
 * @returns the tool output for a completed or failed command.
 * @throws A `TOOL_ABORTED` {@link HarnessError} when the caller cancelled the call.
 */
function finishForeground(result: ShellRunResult): PwshForegroundResult {
  if (result.aborted) {
    const error = new HarnessError('tool call aborted', TOOL_ABORTED)
    error.name = 'AbortError'
    throw error
  }
  return canonicalPwshResult(result)
}

/** Canonical background-handle properties shared by the pwsh output union. */
const BACKGROUND_OUTPUT_PROPERTIES = {
  kind: { type: 'string', required: true, const: 'background' },
  jobId: { type: 'string', required: true },
  /** Present when a foreground call outlived its threshold and kept running. */
  detached: { type: 'boolean' },
  /** The foreground threshold the command outlived, in milliseconds. */
  detachAfterMs: { type: 'number' },
} as const
/* jscpd:ignore-end */

/* jscpd:ignore-start -- deliberate mirror of avn-tool-bash's apply() preamble (pwsh-tool-and-executor Agent Note). */
export function apply(ctx: Context, config: Config = {}): void {
  const backgroundEnabled = config.enableRunInBackground ?? true
  const detachAfterMs = config.detachAfterMs ?? DEFAULT_DETACH_AFTER_MS
  if (!Number.isFinite(detachAfterMs) || detachAfterMs <= 0) {
    throw new Error('tool-pwsh: detachAfterMs must be a positive finite number')
  }
  const defaultMode = ctx.shell.sandboxMode
  const escalationModes: readonly SandboxMode[] = defaultMode === undefined ? [] : ESCALATION_TARGETS
  const sandboxPolicy: SandboxPolicyService | undefined = defaultMode === undefined ? undefined : ctx.get('sandboxPolicy')
  if (defaultMode !== undefined && sandboxPolicy === undefined) {
    throw new Error('tool-pwsh: the mounted bash executor confines but ctx.sandboxPolicy is missing')
  }
  /* jscpd:ignore-end */
  /** Resolve the complete standing policy for this call when a confining executor is mounted. */
  const resolveSandboxPolicy = (exec: ToolExecution): SandboxExecutionPolicy | undefined =>
    sandboxPolicy?.resolve(exec.agent === undefined ? {} : { session: exec.agent.session })

  /* jscpd:ignore-start -- deliberate mirror of avn-tool-bash's escalation resolver (pwsh-tool-and-executor Agent Note). */
  /**
   * Resolve a sandbox-escalation request through `ctx.approval` BEFORE
   * anything executes, delegating the shared fail-closed sequence (strict
   * widening, channel resolution, outcome mapping) to
   * {@link approveEscalation}. This tool contributes only the composition
   * guard (the fields are unadvertised without a sandboxing executor, yet
   * schema validation checks advertised keys only, so an unadvertised
   * `sandbox_permissions` still reaches execute) and the approval
   * ingredients. The shared policy resolver is required whenever the
   * executor advertises confinement, so a split composition fails at
   * tool-plugin load.
   */
  const approvePwshEscalation = (
    mode: string,
    justification: string,
    exec: ToolExecution,
    standingPolicy: SandboxExecutionPolicy | undefined,
  ): Promise<SandboxMode> => {
    if (escalationModes.length === 0) {
      throw new Error('sandbox_permissions is not available in this composition (no sandboxing executor to escalate)')
    }
    const effectiveMode = (standingPolicy as SandboxExecutionPolicy).mode
    return approveEscalation(
      { requestedMode: mode, justification, effectiveMode, subject: 'command' },
      {
        approver: ctx.get('approval'),
        agent: exec.agent,
        callId: exec.callId,
        toolName: 'pwsh',
        signal: exec.signal,
      },
    )
  }
  /* jscpd:ignore-end */

  ctx.systemPrompt.section({
    name: 'tool:pwsh',
    order: ctx.systemPrompt.getSectionOrder('TOOL_PWSH'),
    text: 'Non-zero exits are reported as `[exit code: N]` markers; investigate failures before moving on. '
      + 'Keep the turn responsive: run anything whose duration you cannot bound — installs, builds, test '
      + 'suites, servers, downloads — with `run_in_background: true` and collect it with `job_output` while '
      + 'you keep working. '
      + 'On Windows a killed process settles as `[exit code: 1]` without a signal marker; treat a bare exit 1 after an interruption as a termination, not a command failure.',
  })

  /**
   * Register a pwsh job whose producer is `starter`. The registry runs the
   * starter only after admitting the spec, so preflight finishes before any
   * process exists; a detached foreground run hands its already-live handle
   * through the same path.
   */
  const startJob = (
    jobs: JobRegistry,
    owner: Agent | undefined,
    args: PwshToolArgs,
    starter: () => ShellProcess,
  ): JobId => {
    let proc: ShellProcess | undefined
    return jobs.start({
      kind: 'pwsh',
      label: args.command,
      title: args.description,
      ...owner !== undefined ? { owner: owner.id } : {},
      output: processSources(() => proc),
      run: () => {
        const started = starter()
        proc = started
        return {
          cancel: () => void started.kill(),
          done: started.done.then(() => processOutcome(started)),
        }
      },
    })
  }

  ctx.tools.register(defineTool({
    name: 'pwsh',
    description: pwshDescription(backgroundEnabled, backgroundEnabled ? detachAfterMs : undefined, escalationModes),
    /* jscpd:ignore-start -- deliberate mirror of avn-tool-bash's parameter surface (pwsh-tool-and-executor Agent Note). */
    parameters: {
      command: { type: 'string', required: true, description: 'The PowerShell command to execute.' },
      description: {
        type: 'string',
        required: true,
        description: 'Clear, concise description of what this command does in active voice, '
          + '5-10 words (shown in the UI). Examples: "ls" → "List files in current directory"; '
          + '"git status" → "Show working tree status"; "Get-Process" → "List running processes".',
      },
      timeoutMs: { type: 'number', description: 'Timeout in milliseconds. The executor applies its configured default and cap, and kills the command on expiry.' },
      workdir: { type: 'string', description: 'Working directory for this command. Defaults to the session workspace; a relative path is resolved against it.' },
      ...backgroundEnabled ? {
        run_in_background: { type: 'boolean' as const, description: 'Run in the background and return a job id immediately (collect with job_output, stop with job_kill). No timeout applies.' },
      } : {},
      ...escalationModes.length > 0 ? {
        sandbox_permissions: {
          type: 'string' as const,
          enum: [...escalationModes],
          description: 'The wider sandbox mode this command needs. Only valid as a one-shot retry of a command the sandbox just denied; requires justification and user approval.',
        },
        justification: {
          type: 'string' as const,
          description: 'Required with sandbox_permissions: one sentence for the user explaining why this exact command needs the wider access.',
        },
      } : {},
    },
    /* jscpd:ignore-end */
    output: {
      // The foreground result wire shape mirrors avn-tool-bash's by contract —
      // consumers of one must accept the other (see the pwsh-tool-and-executor
      // Agent Note).
      /* jscpd:ignore-start -- deliberate result-schema symmetry with avn-tool-bash. */
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            properties: BACKGROUND_OUTPUT_PROPERTIES,
          },
          {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true, const: 'foreground' },
              exitCode: { required: true, oneOf: [{ type: 'integer' }, { type: 'null' }] },
              signal: { required: true, oneOf: [{ type: 'string' }, { type: 'null' }] },
              timedOut: { type: 'boolean', required: true },
              aborted: { type: 'boolean', required: true },
              timeoutMs: { type: 'number', required: true },
              stdout: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  text: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  spillPath: { type: 'string' },
                },
              },
              stderr: {
                type: 'object',
                additionalProperties: false,
                required: true,
                properties: {
                  text: { type: 'string', required: true },
                  truncated: { type: 'boolean', required: true },
                  spillPath: { type: 'string' },
                },
              },
              sandbox: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  mode: { type: 'string', required: true },
                  denied: { type: 'boolean', required: true },
                  enforcement: { type: 'string' },
                  runnerFailed: { type: 'boolean' },
                },
              },
            },
          },
        ],
      },
      /* jscpd:ignore-end */
      render: (_args, value) => [{
        type: 'text',
        text: value.kind === 'background'
          ? value.detached === true
            ? `${BACKGROUND_ACK}${value.jobId}: still running after ${value.detachAfterMs}ms in the foreground`
            : `${BACKGROUND_ACK}${value.jobId}`
          : renderPwshResult(value as RenderablePwshResult, escalationModes),
      }],
    },
    /* jscpd:ignore-start -- the execute path mirrors avn-tool-bash's by design (see the pwsh-tool-and-executor Agent Note). */
    async execute(args: PwshToolArgs, exec) {
      validatePwshArgs(args)
      // Description is display metadata; workdir defaults to the caller's session.
      const standingPolicy = resolveSandboxPolicy(exec)
      const approvedMode = args.sandbox_permissions !== undefined && args.justification !== undefined
        ? await approvePwshEscalation(args.sandbox_permissions, args.justification, exec, standingPolicy)
        : undefined
      const policy = approvedMode === undefined
        ? standingPolicy
        : { ...(standingPolicy as SandboxExecutionPolicy), mode: approvedMode }
      const workdir = resolveWorkdir(args.workdir, exec)
      const request = {
        command: args.command,
        ...workdir !== undefined ? { workdir } : {},
        ...args.timeoutMs !== undefined ? { timeoutMs: args.timeoutMs } : {},
        avnEnv: ctx.shellEnv.collect(exec),
        ...policy !== undefined ? { sandboxPolicy: policy } : {},
      }
      if (args.run_in_background === true) {
        // Undeclared keys are allowed, so schema omission also needs enforcement.
        if (!backgroundEnabled) {
          throw new Error('run_in_background is disabled for this deployment (enableRunInBackground: false)')
        }
        const jobs = ctx.get('jobs')
        if (jobs === undefined) {
          throw new Error('background jobs unavailable: load @aeven/jobs and @aeven/tool-jobs')
        }
        // The caller owns cancellation until ctx.jobs commits detached ownership.
        if (exec.signal.aborted) {
          const error = new HarnessError('tool call aborted', TOOL_ABORTED)
          error.name = 'AbortError'
          throw error
        }
        const id = startJob(jobs, exec.agent, args, () => ctx.shell.start(ctx.shell.resolve(request)))
        return { kind: 'background' as const, jobId: id }
      }
      // A foreground command that outlives the threshold becomes a job instead of
      // keeping the turn waiting, so no long command holds the conversation. The
      // executor keeps its timeout: whichever fires first wins, and a timeout
      // still kills the command rather than handing it back.
      const jobs = backgroundEnabled ? ctx.get('jobs') : undefined
      if (jobs === undefined) {
        // Without a registry this call carries no threshold, so it simply waits.
        return finishForeground(await ctx.shell.run(ctx.shell.resolve({ ...request, signal: exec.signal })))
      }
      const result = await ctx.shell.runDetachable(ctx.shell.resolve({ ...request, detachAfterMs, signal: exec.signal }))
      if (isDetachedRun(result)) {
        const id = startJob(jobs, exec.agent, args, () => result.process)
        return { kind: 'background' as const, jobId: id, detached: true, detachAfterMs: result.detachAfterMs }
      }
      return finishForeground(result)
    },
    /* jscpd:ignore-end */
    /* jscpd:ignore-start -- the background call card mirrors presentBashCall's by design (Agent Note). */
    presentCall: (args: PwshToolArgs): TerminalCallView | GenericCallView => {
      // Background acknowledgements carry no terminal exit status; the generic
      // card mirrors the bash tool's background presentation.
      if (args.run_in_background === true) {
        return {
          card: 'generic',
          title: args.command,
          kind: 'execute',
          rawInput: args.command,
          content: [{ type: 'text', text: args.description }],
        }
      }
      return {
        card: 'terminal',
        title: args.command,
        description: args.description,
        ...args.workdir !== undefined ? { cwd: args.workdir } : {},
      }
    },
    /* jscpd:ignore-end */
    /* jscpd:ignore-start -- the completed-result presentation mirrors presentBashResult's by design (Agent Note). */
    presentResult: (args: unknown, result: ToolResult): ToolResultView | undefined => {
      const block = result.content.length === 1 ? result.content[0] : undefined
      if (block === undefined || block.type !== 'text') return undefined
      const raw = block.text
      const isBackground = typeof args === 'object' && args !== null && (args as { run_in_background?: unknown }).run_in_background === true
      // Background acknowledgements — including one handed back from a foreground
      // call — and errors have no terminal exit status.
      if (isBackground || raw.startsWith(BACKGROUND_ACK) || result.isError) {
        return { card: 'generic', content: [{ type: 'text', text: `\`\`\`console\n${raw.replace(/\n+$/, '')}\n\`\`\`` }] }
      }
      // The exit marker becomes the card's exit pill, so it leaves the output body.
      const { body, ...exit } = parseExitStatus(raw)
      return { card: 'terminal', output: body, ...exit }
    },
    /* jscpd:ignore-end */
  }))
}
