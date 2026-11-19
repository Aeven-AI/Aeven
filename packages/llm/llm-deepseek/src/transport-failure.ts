/**
 * Names the network reason behind a failed `fetch`.
 *
 * Node's `fetch` rejects every network failure with the same `TypeError: fetch
 * failed`; the reason (`ECONNRESET`, `UND_ERR_CONNECT_TIMEOUT`, a TLS alert)
 * sits in its `cause` chain, which session logs and retry records do not keep.
 * Folding it into the error message is what lets a failed turn on a weak network
 * say which step broke.
 * @module
 */

/** Deepest `cause` levels inspected; undici nests at most three. */
const MAX_CAUSE_DEPTH = 5

/**
 * Describe the deepest coded error in a fetch failure's cause chain.
 * @param error - the value `fetch` rejected with.
 * @returns `CODE: message` of the deepest error carrying a string `code`, or undefined when no level has one.
 */
export function transportFailureDetail(error: unknown): string | undefined {
  let detail: string | undefined
  let current: unknown = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH && typeof current === 'object' && current !== null; depth += 1) {
    const { code, message, cause } = current as { code?: unknown; message?: unknown; cause?: unknown }
    if (typeof code === 'string') {
      detail = typeof message === 'string' && message !== '' && message !== code ? `${code}: ${message}` : code
    }
    current = cause
  }
  return detail
}

/**
 * Append the network reason to a transport failure message.
 * @param message - the failed operation, for example `Aeven API request to https://aeven.io/api/v1 failed`.
 * @param error - the value `fetch` or the stream rejected with.
 * @returns the message, followed by ` (CODE: reason)` when the cause chain names one.
 */
export function transportFailureMessage(message: string, error: unknown): string {
  const detail = transportFailureDetail(error)
  return detail === undefined ? message : `${message} (${detail})`
}
