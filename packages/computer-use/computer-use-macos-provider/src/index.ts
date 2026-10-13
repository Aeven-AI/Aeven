/**
 * The macOS computer-use provider for Æven.
 *
 * This is the package that makes the rest of the stack reachable from a
 * composition. It registers the adapter, wires the recipe book to it, and exposes
 * the session a consumer drives — all in one row of a profile patch.
 *
 * ## Why the pieces are separate packages
 *
 * The layers below this one are deliberately independent: the contract knows nothing
 * about macOS, the router knows nothing about the executor, and the layout tier knows
 * nothing about either. This package is where the decisions meet, and it is the only
 * place that has to know the whole shape. That is also why it is the *provider* rather
 * than more code inside the adapter — a second platform adds a provider, not a branch.
 *
 * The model-facing batch tool drives an operation-local session, returns independent
 * verification, and requires approval for tasks that change applications or files.
 *
 * @module @aeven/computer-use-macos-provider
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@aeven/tools'
import type {} from '@aeven/sandbox-policy'
import ComputerUseRegistry, { ComputerUseProviderName } from '@aeven/computer-use'

import type { DesktopAdapter, ReadinessReport } from '@aeven/computer-use-desktop'
import { resolveDesktopPlatform } from '@aeven/computer-use-desktop'
import { TaskExecutor, type ExecutionOutcome } from '@aeven/computer-use-executor'
import type { RecipeBook, ResolvedRecipe } from '@aeven/computer-use-router'
import { STARTER_BOOK } from '@aeven/computer-use-router'
import { ComputerUseSession } from '@aeven/computer-use-session'
import { MacDesktopAdapter } from '@aeven/computer-use-macos'
import type { MacCommandRunner } from '@aeven/computer-use-macos'
import { createAppleEventsHandler, type AppleEventsRunner } from '@aeven/computer-use-macos-apple-events'

/** Cordis plugin name. */
export const name = 'computer-use-macos-provider'

/** Required services: the exclusive registration slot this provider claims. */
export const inject = ['computerUse']

/** The provider identity recorded in the registration diagnostics. */
export const providerName = ComputerUseProviderName('macos-first-party')

/** Configuration a composition may supply. */
export interface Config {
  /**
   * Bundle ids whose Automation permission the readiness report should probe.
   *
   * Empty by default: probing sends an Apple Event, and on macOS the first event to an
   * application raises a consent prompt. Prompting for applications the user has not
   * asked for is exactly the behaviour this stack set out to remove, so a deployment
   * names its applications deliberately.
   */
  automationTargets?: string[]
  /**
   * Extra recipes merged over the starter book, so a deployment can add its own
   * without this package knowing about them.
   */
  recipes?: RecipeBook
  /**
   * Whether to claim the exclusive slot. Present so a deployment can load this row for
   * its readiness reporting while another provider drives, which is how a migration off
   * the MCP wrapper is staged rather than cut over.
   */
  register?: boolean
}

/**
 * Run `osascript` and capture its streams.
 *
 * Non-zero exits resolve rather than reject: `osascript` reports application-level
 * failures through its exit status, and a caller needs to see the status and the
 * message together to tell "the app said no" from "the command did not run".
 * @param signal - cancellation of the calling batch.
 * @returns the runner the Apple Events handler uses.
 */
export function createOsascriptRunner(signal?: AbortSignal): AppleEventsRunner {
  const run = promisify(execFile)
  return {
    run: async (script: string, language: 'JavaScript' | 'AppleScript' = 'JavaScript') => {
      try {
        const { stdout, stderr } = await run('osascript', ['-l', language, '-e', script], { maxBuffer: 32 * 1024 * 1024, ...signal === undefined ? {} : { signal } })
        return { code: 0, stdout, stderr }
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string }
        return {
          code: failure.code ?? 1,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? String(error),
        }
      }
    },
  }
}

/**
 * Run an arbitrary host command for the desktop adapter.
 *
 * Distinct from {@link createOsascriptRunner} because the two answer different
 * questions: this one runs *a program* — the AX walk, the readiness probes — while
 * the Apple Events runner runs *a script* through `osascript`. Both report a non-zero
 * exit as a resolved result, because the adapter branches on exit codes.
 * @returns the runner the macOS adapter uses.
 */
export function createMacCommandRunner(): MacCommandRunner {
  const run = promisify(execFile)
  return {
    run: async (command: string, args: readonly string[], signal?: AbortSignal) => {
      try {
        const { stdout, stderr } = await run(command, [...args], { maxBuffer: 32 * 1024 * 1024, ...signal === undefined ? {} : { signal } })
        return { code: 0, stdout, stderr }
      } catch (error) {
        const failure = error as { code?: number; stdout?: string; stderr?: string }
        return {
          code: typeof failure.code === 'number' ? failure.code : 1,
          stdout: failure.stdout ?? '',
          stderr: failure.stderr ?? String(error),
        }
      }
    },
  }
}

/**
 * The macOS computer-use provider.
 *
 * Exposes the pieces a consumer needs rather than hiding them behind one method,
 * because the useful questions differ: a settings surface wants `readiness()`, a
 * router wants `routing`, and a tool wants `session`.
 */
export class MacComputerUseProvider {
  /** The adapter every observation and verification goes through. */
  readonly adapter: DesktopAdapter

  /** The session a consumer drives. */
  readonly session: ComputerUseSession

  /** The executor, exposed so a caller can run a single task without a session. */
  readonly executor: TaskExecutor

  /**
   * @param config - the deployment's configuration.
   * @param signal - cancellation forwarded to the batch's host commands.
   */
  constructor(config: Config = {}, signal?: AbortSignal) {
    // The adapter runs programs — the AX walk and the readiness probes — so it
    // takes the command runner. The Apple Events handler speaks AppleScript, so it
    // takes the `osascript` runner: handing it the command runner would run the
    // script text as a program name.
    const commands = createMacCommandRunner()
    const scripts = createOsascriptRunner(signal)
    this.adapter = new MacDesktopAdapter({
      runner: commands,
      ...signal === undefined ? {} : { signal },
      ...config.automationTargets === undefined ? {} : { automationTargets: config.automationTargets },
    })
    const book: RecipeBook = [...STARTER_BOOK, ...config.recipes ?? []]
    this.executor = new TaskExecutor({
      book,
      adapter: this.adapter,
      handlers: { 'apple-events': createAppleEventsHandler({ runner: scripts }) },
    })
    this.session = new ComputerUseSession({
      book,
      adapter: this.adapter,
      handlers: { 'apple-events': createAppleEventsHandler({ runner: scripts }) },
    })
  }

  /**
   * The host's readiness: which grants are held, by which identity, and by what.
   * @returns the readiness report for this adapter.
   */
  readiness(): Promise<ReadinessReport> {
    return this.adapter.readiness()
  }

  /**
   * Perform one task and establish whether it worked.
   * @param request - the task, its application, and its parameters.
   * @returns the outcome, with per-expectation results.
   */
  execute(request: Parameters<TaskExecutor['execute']>[0]): Promise<ExecutionOutcome> {
    return this.executor.execute(request)
  }

  /**
   * Resolve a task without running it, for a caller that wants to show the plan.
   * @param request - the task, platform, application and available rungs.
   * @returns the resolved recipe.
   */
  resolve(request: Parameters<TaskExecutor['routing']['resolve']>[0]): ResolvedRecipe {
    return this.executor.routing.resolve(request)
  }

  /**
   * The recipe book this provider serves, so a caller can list what is available.
   * @returns the task names.
   */
  tasks(): string[] {
    return this.executor.routing.tasks()
  }
}

/**
 * Mount the provider.
 *
 * Registration is claimed through the seam rather than by re-implementing it, so
 * loading a second provider still fails with the name of the one already registered —
 * the behaviour the seam exists for.
 * @param ctx - the plugin context, with `computerUse` injected.
 * @param config - the deployment's configuration.
 */
export function apply(ctx: Context, config: Config = {}): void {
  const provider = new MacComputerUseProvider(config)
  // Claim the seam's slot *before* publishing, so a duplicate load is refused by the
  // registry with the name of the provider already there. Publishing first would let
  // Cordis's own "service already registered" error win, which names the slot but not
  // the owner, and names it in Cordis's vocabulary rather than this seam's.
  if (config.register !== false) {
    ctx.computerUse.register(providerName)
  }
  // `provide`, not `set`: the name has to be claimed before it can hold a value, and
  // the returned disposer is what makes unloading this plugin release the slot again.
  ctx.provide('computerUseProvider', provider)
  ctx.inject(['tools'], (ctx) => {
    ctx.on('tools/pre-execute', async (exec, next) => {
      const decision = await next()
      if (decision.kind !== 'allow' || exec.name !== 'computer_use_run') return decision
      const args = exec.arguments as { steps?: unknown } | null
      if (args === null || !Array.isArray(args.steps)) return { kind: 'deny', reason: 'Computer-use batches require a steps array.' }
      if (!args.steps.some((step: unknown) => typeof step === 'object' && step !== null && 'kind' in step && step.kind === 'execute')) return decision
      const policy = ctx.get('sandboxPolicy')
      if (exec.agent === undefined || policy === undefined || policy.resolve({ session: exec.agent.session }).mode === 'read-only') {
        return { kind: 'deny', reason: 'Computer-use tasks require a calling session with write access.' }
      }
      return { kind: 'ask', reason: `Allow these computer-use tasks on this Mac? ${JSON.stringify(exec.arguments)}` }
    })
    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'computer_use_run',
      description: 'Run 1 to 20 computer-use steps in order on this Mac in one call. execute performs a recipe task and independently verifies its expectations; observe returns accessibility nodes and a tree diff; readiness reports permissions. Stops at the first error or unverified task and returns per-step results plus verified. Only verified execution outcomes establish success. Completed steps may have changed the application: do not repeat them when correcting a later failure. Prefer existing connectors and file tools when they cover the task. This batch supports semantic recipes; use the computer-use interaction tools for tasks requiring accessibility or vision.',
      parameters: {
        steps: { type: 'array', required: true, items: { oneOf: [
          { type: 'object', additionalProperties: false, properties: {
            kind: { type: 'string', const: 'execute', required: true },
            task: { type: 'string', enum: provider.tasks(), required: true },
            app: { type: 'string', description: 'Application bundle id when the recipe is application-specific.' },
            parameters: { type: 'object', additionalProperties: true, description: 'String recipe values such as path, text, title. The same values fill the verification expectations.' },
          } },
          { type: 'object', additionalProperties: false, properties: {
            kind: { type: 'string', const: 'observe', required: true },
            pid: { type: 'integer' }, windowId: { type: 'string' }, maxNodes: { type: 'integer' },
          } },
          { type: 'object', additionalProperties: false, properties: { kind: { type: 'string', const: 'readiness', required: true } } },
        ] } },
      },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args, exec) {
        if (args.steps.length === 0 || args.steps.length > 20) throw new Error('computer_use_run requires 1 to 20 steps')
        const session = new MacComputerUseProvider(config, exec.signal).session
        const steps = args.steps.map(step => {
          switch (step.kind) {
            case 'execute': {
              const parameters: Record<string, string> = {}
              for (const [key, value] of Object.entries(step.parameters ?? {})) {
                if (typeof value !== 'string') throw new Error(`recipe parameter ${key} must be a string`)
                parameters[key] = value
              }
              return { kind: 'execute' as const, request: {
                task: step.task, platform: 'darwin' as const, availableRungs: ['semantic' as const],
                ...step.app === undefined ? {} : { app: step.app },
                parameters,
              } }
            }
            case 'observe': return { kind: 'observe' as const, scope: {
              ...step.pid === undefined ? {} : { pid: step.pid },
              ...step.windowId === undefined ? {} : { windowId: step.windowId },
              ...step.maxNodes === undefined ? {} : { maxNodes: step.maxNodes },
            } }
            case 'readiness': return { kind: 'readiness' as const }
          }
        })
        return JSON.stringify(await session.run(steps, exec.signal))
      },
    })), 'computer-use-macos-provider.batch-tool')
  })
  // Not optional-chained: Cordis types `logger` and its methods as always present,
  // and guarding a value that cannot be absent only hides it if that ever changes.
  ctx.logger.info('computer use: macOS provider ready on %s with %d task(s)', resolveDesktopPlatform(process.platform), provider.tasks().length)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The macOS computer-use provider, present once this plugin is loaded. */
    computerUseProvider: MacComputerUseProvider
  }
}

export { ComputerUseRegistry }
