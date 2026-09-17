/**
 * The error every Aeven API refusal is reported as.
 * @module
 */

/** A refusal carrying the API's own status, so callers can tell it from an outage. */
export class AevenApiError extends Error {
  /**
   * @param message - the API's error code, or a transport failure.
   * @param status - the HTTP status, when there was a response.
   */
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AevenApiError'
  }
}

/**
 * The one 400 that is not about the session.
 *
 * `/set-display-name` answers 400 with this code for a name it will not store.
 * A refused name leaves the session intact, and sending the reader to sign in
 * over one would end a session the API never questioned — so the code, not the
 * status alone, decides.
 */
const NAME_REFUSAL_CODE = 'invalid-display-name'

/**
 * Whether a failure means the Aeven session no longer exists.
 *
 * `/refresh-token` answers 400 when no refresh cookie is present and 401 when
 * the cookie is invalid or already rotated; both leave nothing to retry with. A
 * transport failure or a 5xx says nothing about the session, and a refused name
 * is a refusal of a value rather than of the credential.
 * @param error - the failure a session operation threw.
 * @returns true when the reader must sign in again.
 */
export function isSessionRefusal(error: unknown): boolean {
  return error instanceof AevenApiError
    && error.message !== NAME_REFUSAL_CODE
    && (error.status === 400 || error.status === 401)
}
