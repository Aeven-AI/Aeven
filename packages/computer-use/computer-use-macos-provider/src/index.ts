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
 * ## What is wired, and what is not
 *
 * Wired: the command runner, the Apple Events mechanism handler, the recipe book, the
 * executor, the session, and the readiness report.
 *
 * **Not wired: the model-facing tool surface.** Nothing here registers a tool, a prompt
 * section, or a schema, so a Session cannot yet ask the model to do anything — this
 * exposes the service and the session object a tool would drive. `@aeven/computer-use`
 * owns the exclusive registration slot; this provider claims it.
 *
 * @module @aeven/computer-use-macos-provider
 */

import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { Context } from '@deepseek-ai/cordis'
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
 * @returns the runner the Apple Events handler uses.
 */
export function createOsascriptRunner(): AppleEventsRunner {
  const run = promisify(execFile)
  return {
    run: async (script: string, language: 'JavaScript' | 'AppleScript' = 'JavaScript') => {
      try {
        const { stdout, stderr } = await run('osascript', ['-l', language, '-e', script], { maxBuffer: 32 * 1024 * 1024 })
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
   */
  constructor(config: Config = {}) {
    // The adapter runs programs — the AX walk and the readiness probes — so it
    // takes the command runner. The Apple Events handler speaks AppleScript, so it
    // takes the `osascript` runner: handing it the command runner would run the
    // script text as a program name.
    const commands = createMacCommandRunner()
    const scripts = createOsascriptRunner()
    this.adapter = new MacDesktopAdapter({
      runner: commands,
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

export default apply
export { ComputerUseRegistry }
