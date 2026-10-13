/**
 * Aeven error base with a stable machine-routable code and chained cause.
 * Package errors extend it so tool results and replay can retain failure class.
 * @module @aeven/llm/error
 */

/**
 * Base class for all harness errors. Carries a `code` (stable, programmatic —
 * e.g. `NO_ADAPTER`, `INVALID_ARGS`, `INVARIANT`) distinct from the
 * human-readable `message`, and supports `cause` chaining via the standard
 * `ErrorOptions`. `name` defaults to the subclass constructor name.
 */
export class HarnessError extends Error {
  /** Stable machine-routable failure class (e.g. `RATE_LIMIT`); route on this, never by parsing `message`. */
  readonly code: string

  constructor(message: string, code: string, options?: ErrorOptions) {
    super(message, options)
    this.code = code
    this.name = new.target.name
  }
}

/** Canonical provider-neutral code for a model request rejected because its context window was exceeded. */
export const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED'

/**
 * Canonical provider-neutral code for a model request rejected because it
 * carried more message entries than the endpoint admits. Distinct from
 * {@link CONTEXT_WINDOW_EXCEEDED_CODE} because the bound counts entries rather
 * than tokens: a conversation well inside the model's window still reaches it,
 * and gateways name it on the `messages` parameter instead of reporting a
 * context length. Both mean the same thing to a caller — a request that was
 * admitted as shaped and then grew past a ceiling — so compaction recovery
 * treats them alike.
 */
export const MESSAGE_COUNT_EXCEEDED_CODE = 'MESSAGE_COUNT_EXCEEDED'

/** Canonical provider-neutral code for an exhausted account quota or balance. */
export const QUOTA_EXCEEDED_CODE = 'QUOTA'

/**
 * Canonical provider-neutral code for a response that completed normally but
 * carried no content blocks at all. Providers occasionally emit a degenerate
 * completion (a terminal stop with zero output); adapters classify it as this
 * failure instead of yielding an empty assistant message, because an empty
 * message silently ends the turn with nothing for the user or the loop to act
 * on. The attempt produced nothing durable, so retry policy treats it as safe
 * to repeat.
 */
export const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE'

/**
 * Canonical provider-neutral code for a credential that was supplied but
 * cannot be used — malformed rather than absent. Distinct from
 * `MISSING_CREDENTIAL` because the fix differs: correct the stored value
 * rather than supply one. Deliberately outside the default retryable set —
 * a malformed credential fails identically on every attempt.
 */
export const INVALID_CREDENTIAL_CODE = 'INVALID_CREDENTIAL'

/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]`
  + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  'i',
)

/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?`
  + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?`
  + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  'i',
)

/** "Exceeds" wording is safe only when its object is explicitly the model context. */
const EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}`
  + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}`
  + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  'i',
)

/**
 * Recognize the context-overflow wording used by OpenAI-compatible providers
 * and library adapters. Adapters pass all available provider code, type, and
 * message text so both thrown and in-band delivery styles share one classifier.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true when the detail identifies a request exceeding the model context window.
 */
export function isContextWindowExceededError(detail: string): boolean {
  return STRUCTURED_CONTEXT_OVERFLOW.test(detail)
    || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail)
    || TOO_LARGE_FOR_CONTEXT.test(detail)
    || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail)
    || EXCEEDS_MODEL_CONTEXT.test(detail)
}

/**
 * Message-entry ceiling wording, bound to the `messages` parameter by
 * `MESSAGES_PARAMETER`. A number and the word "entries" appear in plenty of
 * other rejections, so the parameter named beside them is what makes the match
 * specific enough to route on.
 */
const MESSAGES_PARAMETER = new RegExp(
  String.raw`(?:^|[^a-z0-9_])messages(?:$|[^a-z0-9_])`,
  'i',
)

/** A count of entries bounded by a ceiling, i.e. an array admitted up to a limit. */
const ENTRIES_CEILING = new RegExp(
  String.raw`(?:may|must|can|cannot|can't)\s+(?:only\s+)?`
  + String.raw`(?:contain|hold|include|carry)\s+(?:at\s+most|no\s+more\s+than|up\s+to|fewer\s+than)\s+`
  + String.raw`\d+\s+entr(?:y|ies)`,
  'i',
)

/** The same ceiling stated as a maximum, which is how typed errors usually phrase it. */
const ENTRIES_MAXIMUM = new RegExp(
  String.raw`\b(?:maximum|max)\s+(?:number\s+of\s+)?(?:allowed\s+)?entr(?:y|ies)`,
  'i',
)

/** A count of entries compared against an unnamed bound. */
const ENTRIES_OVER_LIMIT = new RegExp(
  String.raw`\b(?:too\s+many\s+|exceed(?:s|ed|ing)?\s+(?:the\s+)?(?:allowed\s+|maximum\s+)?)entr(?:y|ies)\b`,
  'i',
)

/**
 * Recognize the wording a gateway uses when a request carries more message
 * entries than its endpoint accepts. Adapters pass all available provider code,
 * type, and message text, so both thrown and in-band delivery styles share one
 * classifier — and a route whose ceiling is lower than the provider's own is
 * recognized the same way as one the provider enforces.
 *
 * The match deliberately requires the `messages` parameter: a rejection that
 * never names it is left to {@link isContextWindowExceededError}, so a token
 * overflow phrased around entries is not mistaken for a count overflow.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true when the detail identifies a request carrying more messages than allowed.
 */
export function isMessageCountExceededError(detail: string): boolean {
  if (!MESSAGES_PARAMETER.test(detail)) return false
  return ENTRIES_CEILING.test(detail)
    || ENTRIES_MAXIMUM.test(detail)
    || ENTRIES_OVER_LIMIT.test(detail)
}

/**
 * Funding-exhausted wording, in the spelling gateways and adapters actually send.
 *
 * The `(?:^|[^a-z0-9])` boundaries are load-bearing rather than decorative, because
 * `\b` does not fire inside an underscore-joined `code` or `type`: the character
 * before `BALANCE` in `AEVEN_INFERENCE_BALANCE_EXHAUSTED` is `_`, which counts as a
 * word character, and the same is true of `insufficient_inference_balance`. Æven's own
 * `/v1` gateway sends exactly those two strings, so a `\b`-anchored pattern read a
 * spent balance as an unknown `HTTP_402` — a code nothing treats as terminal, on the
 * one failure whose remedy the gateway had already named.
 */
const INSUFFICIENT_FUNDS = new RegExp(
  String.raw`(?:^|[^a-z0-9])insufficient[\s_-]+(?:[a-z0-9]+[\s_-]+)*`
  + String.raw`(?:quota|balances?|credits?)(?:$|[^a-z0-9])`,
  'i',
)

/**
 * A balance or credit described as gone: `BALANCE_EXHAUSTED`, "balance is used up",
 * "credits depleted". The description is matched as well as the label because the two
 * reach us separately — the code in one field, the sentence in another — and either
 * one alone has to be enough.
 */
const EXHAUSTED_FUNDS = new RegExp(
  String.raw`(?:^|[^a-z0-9])(?:balances?|credits?)[\s_-]+(?:is[\s_-]+)?`
  + String.raw`(?:exhausted|depleted|used[\s_-]+up|spent|empty)(?:$|[^a-z0-9])`,
  'i',
)

/**
 * Recognize provider wording that identifies an exhausted account quota rather
 * than a transient request-rate limit.
 * @param detail - provider error code/type/message text joined into one string.
 * @returns true only for terminal quota, balance, credit, budget, or usage-limit wording.
 */
export function isQuotaExceededError(detail: string): boolean {
  return INSUFFICIENT_FUNDS.test(detail)
    || EXHAUSTED_FUNDS.test(detail)
    || /\b(?:quota|usage[\s_-]+limit)[\s_-]+(?:exceeded|exhausted|reached)\b/i.test(detail)
    || /\bexceed(?:ed|s)?[\s_-]+(?:(?:your|the)[\s_-]+)?(?:current[\s_-]+)?quota\b/i.test(detail)
    || /\bout[\s_-]+of[\s_-]+(?:credits?|budget)\b/i.test(detail)
}

/**
 * Render a thrown value with its full `cause` chain and AggregateError
 * members, so transport wrappers like undici's `TypeError: fetch failed`
 * surface the underlying failure instead of masking it. Plain structured
 * failures render their own data-backed `message`. Diagnostic-surface
 * rendering only (messages, notices, logs) — never parse the result; route on
 * {@link HarnessError.code}.
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns the outermost message first, each cause appended with `: ` (skipped
 * when it repeats the wrapper message verbatim), and AggregateError members
 * bracketed and `; `-joined.
 */
export function errorChain(value: unknown): string {
  // Tracks the active recursion path (entries removed on exit), so only true
  // cycles are flagged and a diamond-shared cause still renders in full.
  const path = new Set<unknown>()
  const render = (current: unknown): string => {
    if (path.has(current)) return '<circular cause>'
    path.add(current)
    try {
      if (!(current instanceof Error)) {
        if (typeof current === 'object' && current !== null) {
          const descriptor = Object.getOwnPropertyDescriptor(current, 'message')
          if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
            return descriptor.value
          }
        }
        return String(current)
      }
      const message = current.message === '' ? current.name : current.message
      const members = current instanceof AggregateError && current.errors.length > 0
        ? ` [${current.errors.map(render).join('; ')}]`
        : ''
      const causeText = current.cause === undefined || current.cause === null
        ? ''
        : render(current.cause)
      // Wrappers like `new HarnessError(String(value), code, { cause: value })`
      // repeat their cause verbatim; rendering it again would only add noise.
      const cause = causeText === '' || causeText === message ? '' : `: ${causeText}`
      return `${message}${members}${cause}`
    } catch {
      // Only hostile coercion or hostile accessors (a throwing toString /
      // Symbol.toPrimitive on a non-Error, or a throwing message/name/cause/
      // errors getter on an Error subclass): this renderer feeds UI notices
      // and logs, so nothing may escape. Inner frames catch their own throws,
      // so only the hostile node collapses, not the whole chain.
      return '<unrenderable value>'
    } finally {
      path.delete(current)
    }
  }
  return render(value)
}

/**
 * Narrow an arbitrary thrown value to a HarnessError (for `instanceof` at runtime boundaries).
 * @param value - the caught value (`unknown` in catch clauses).
 * @returns true only for real instances; duck-typed or cross-realm errors do not narrow.
 */
export function isHarnessError(value: unknown): value is HarnessError {
  return value instanceof HarnessError
}
