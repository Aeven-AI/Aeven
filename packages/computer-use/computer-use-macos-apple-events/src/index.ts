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

/** Runs one Apple Events program and reports its streams. */
export interface AppleEventsRunner {
  /**
   * @param script - the program source to run.
   * @param language - which `osascript` dialect `script` is written in. JavaScript
   * when omitted, because JXA is the default and the older callers predate the flag.
   * @returns the process streams; a non-zero exit resolves rather than rejects,
   * because `osascript` reports application failures through its exit status.
   */
  run(
    script: string,
    language?: 'JavaScript' | 'AppleScript',
  ): Promise<{ code: number | null; stdout: string; stderr: string }>
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
 * Embed a value as an AppleScript string literal.
 *
 * Needed in addition to {@link jsLiteral} because Keynote's scripting bridge does
 * not work through JXA on current builds — `Application('com.apple.Keynote')`
 * cannot convert its `master slides` and exposes no `properties()`, so Keynote is
 * driven in its native dialect instead. AppleScript has no escape for a line
 * break inside a literal, so those are concatenated as `character id` expressions;
 * a literal carrying a raw newline would be a syntax error rather than a value.
 * @param value - the raw value.
 * @returns the literal, including its quotes.
 */
export function appleScriptLiteral(value: string): string {
  const parts: string[] = []
  for (const char of value) {
    if (char === '"') parts.push('\\"')
    else if (char === '\\') parts.push('\\\\')
    else if (char === '\n') parts.push('" & (character id 10) & "')
    else if (char === '\r') parts.push('" & (character id 13) & "')
    else if (char === '\t') parts.push('" & (character id 9) & "')
    else parts.push(char)
  }
  return `"${parts.join('')}"`
}

/**
 * Whether an application reference is a bundle identifier rather than a name.
 *
 * Reverse-DNS shape: at least two dot-separated labels, none empty, and no spaces.
 * `com.apple.Keynote` is an id; `Keynote` and `Keynote Creator Studio` are names.
 * @param app - the application reference from the request.
 * @returns true when the value should be used with `application id`.
 */
export function isBundleId(app: string): boolean {
  return /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$/.test(app)
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
        notes: ['created and saved through Apple Events in one call'],
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

    // Keynote, in AppleScript and against its own object model. Two facts measured on
    // a live build shape every statement below:
    //
    //   1. `make new slide` must be *targeted at the document*. The untargeted form
    //      fails with -10024 "Can't make or move that element into that container".
    //   2. A slide will not accept a new text item, and `make new text item with
    //      properties {object text:…}` fails the same way. A slide arrives from its
    //      layout already carrying its placeholders, so text is written into an
    //      existing one. Their payloads are empty on a fresh slide, which is why the
    //      index is addressed explicitly rather than searched by content.
    if (operation === 'keynote.setSlideText') {
      const path = parameters.path
      const text = parameters.text
      const title = parameters.title
      const slideIndex = Math.max(1, Math.trunc(Number(parameters.slideIndex ?? '1')))
      const textItem = Math.max(1, Math.trunc(Number(parameters.textItem ?? '1')))
      if (path === undefined || text === undefined) {
        throw new Error('setting slide text requires path and text parameters')
      }
      // AppleScript's `tell application` takes a name; a bundle identifier needs the
      // `application id` form. Recipes carry bundle ids, so the right form is chosen
      // from the value rather than from a table of names that would rot.
      const target = isBundleId(app)
        ? `application id ${appleScriptLiteral(app)}`
        : `application ${appleScriptLiteral(app)}`
      const titleLines = title === undefined
        ? []
        : [`  set object text of text item 1 of theSlide to ${appleScriptLiteral(title)}`]
      const script = `
set aevenText to ""
tell ${target}
  set theDoc to make new document
  repeat with i from 2 to ${slideIndex}
    tell theDoc to make new slide
  end repeat
  set theSlide to slide ${slideIndex} of theDoc
${titleLines.join('\n')}
  set object text of text item ${textItem} of theSlide to ${appleScriptLiteral(text)}
  set readBack to object text of text item ${textItem} of theSlide
  save theDoc in ${appleScriptLiteral(path)}
  set aevenText to readBack
  close theDoc saving no
end tell
return aevenText
`
      const result = await options.runner.run(script, 'AppleScript')
      if (result.code !== 0) {
        throw new Error(failure(result.stderr, 'setting slide text'))
      }
      return {
        observed: result.stdout.trim(),
        notes: ['written into a layout placeholder and read back through Keynote'],
      }
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
