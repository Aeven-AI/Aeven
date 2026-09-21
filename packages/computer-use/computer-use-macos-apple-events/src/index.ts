/**
 * The Apple Events mechanism for macOS.
 *
 * Registered with `@aeven/computer-use-executor` by a consumer that knows it is
 * on macOS. It runs a recipe's operation through `osascript`, and it exists
 * because this is the one mechanism whose payoff is measured rather than assumed:
 * creating a Pages document containing text is **one call** this way, against
 * more than twenty through the accessibility tree that failed.
 *
 * Two things it deliberately does not do.
 *
 * It does not treat its own output as a verdict. A handler reports what it
 * observed; the executor decides, by re-reading an independent observable. That
 * separation is what caught a save reporting success while writing nothing.
 *
 * It does not attempt what the recipe declares blind. An operation that the
 * scripting bridge cannot perform is an entry in `knownBlind`, resolved to
 * another rung before it ever reaches here.
 *
 * @module @aeven/computer-use-macos-apple-events
 */

import type { MechanismHandler, MechanismResult } from '@aeven/computer-use-executor'

/** Runs one JXA program and reports its streams. */
export interface AppleEventsRunner {
  /**
   * @param script - the JXA source to run.
   * @returns the process streams; a non-zero exit resolves rather than rejects,
   * because `osascript` reports application failures through its exit status.
   */
  run(script: string): Promise<{ code: number | null, stdout: string, stderr: string }>
}

/** Options for constructing the handler. */
export interface AppleEventsHandlerOptions {
  runner: AppleEventsRunner
  /**
   * How a value is embedded in generated script source. Defaults to a JSON string
   * literal, which is valid JavaScript and therefore safe for arbitrary text.
   */
  literal?: (value: string) => string
}

/**
 * Escape a value for embedding as a JXA string literal.
 *
 * `JSON.stringify` is used rather than hand-rolled escaping: it produces a valid
 * JavaScript string literal for every input, including quotes, backslashes,
 * newlines and non-BMP characters, so a document containing quotes cannot break
 * out of the literal it was pasted into.
 * @param value - the raw value.
 * @returns the literal, including its quotes.
 */
export function jsLiteral(value: string): string {
  return JSON.stringify(value)
}

/**
 * Report an application failure with its stderr attached.
 * @param stderr - the process's standard error.
 * @param what - the operation being attempted.
 * @returns the message to raise.
 */
function failure(stderr: string, what: string): string {
  const detail = stderr.trim()
  return detail.length > 0 ? `${what} failed: ${detail}` : `${what} failed without reporting a reason`
}

/**
 * Build the handler for the Apple Events mechanism.
 *
 * Operations are matched by name against the vocabulary the recipe book uses, and
 * an unrecognised operation is refused rather than attempted — a recipe naming an
 * operation nothing implements is a bug worth surfacing, not a silence worth
 * tolerating.
 * @param options - the runner and optional literal encoder.
 * @returns the mechanism handler.
 */
export function createAppleEventsHandler(options: AppleEventsHandlerOptions): MechanismHandler {
  const literal = options.literal ?? jsLiteral
  return async (request): Promise<MechanismResult> => {
    const { operation } = request.invocation
    const parameters = request.parameters
    const app = request.app ?? ''
    const target = app.length > 0 ? `Application(${literal(app)})` : 'Application.currentApplication()'

    if (operation.startsWith('Document().make()')) {
      const path = parameters.path
      const text = parameters.text
      if (path === undefined || text === undefined) {
        throw new Error('creating a document requires path and text parameters')
      }
      const script = `
const Pages = ${target}
Pages.includeStandardAdditions = true
const doc = Pages.Document().make()
doc.bodyText = ${literal(text)}
doc.save({ in: Path(${literal(path)}) })
const written = String(doc.bodyText())
JSON.stringify({ ok: true, characters: written.length })
`
      const result = await options.runner.run(script)
      if (result.code !== 0) {
        throw new Error(failure(result.stderr, 'creating the document'))
      }
      return {
        observed: result.stdout.trim(),
        notes: [`created and saved through Apple Events in one call`],
      }
    }

    if (operation === 'accounts.name()') {
      const script = `
const Mail = ${target}
JSON.stringify({ ok: true, accounts: Mail.accounts.name() })
`
      const result = await options.runner.run(script)
      if (result.code !== 0) {
        throw new Error(failure(result.stderr, 'listing accounts'))
      }
      return { observed: result.stdout.trim() }
    }

    if (operation.startsWith('inbox.messages')) {
      const count = Number(parameters.count ?? '5')
      const script = `
const Mail = ${target}
const messages = Mail.inbox.messages
const limit = Math.min(${String(Number.isFinite(count) ? count : 5)}, messages.length)
const subjects = []
for (let i = 0; i < limit; i++) { subjects.push(String(messages[i].subject())) }
JSON.stringify({ ok: true, total: messages.length, subjects: subjects })
`
      const result = await options.runner.run(script)
      if (result.code !== 0) {
        throw new Error(failure(result.stderr, 'reading inbox subjects'))
      }
      return { observed: result.stdout.trim() }
    }

    if (operation === 'calendars.name()') {
      const script = `
const Calendar = ${target}
JSON.stringify({ ok: true, calendars: Calendar.calendars.name() })
`
      const result = await options.runner.run(script)
      if (result.code !== 0) {
        throw new Error(failure(result.stderr, 'listing calendars'))
      }
      return { observed: result.stdout.trim() }
    }

    throw new Error(`the Apple Events handler does not implement "${operation}"`)
  }
}

/**
 * The mechanism name this handler registers under.
 *
 * Exported so a consumer registers it without repeating the string, and because
 * the name must match what the recipe book declares.
 */
export const APPLE_EVENTS_MECHANISM = 'apple-events'
