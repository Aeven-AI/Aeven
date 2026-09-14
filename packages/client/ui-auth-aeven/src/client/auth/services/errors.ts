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
 * Whether a failure means the Aeven session no longer exists.
 *
 * `/refresh-token` answers 400 when no refresh cookie is present and 401 when
 * the cookie is invalid or already rotated; both leave nothing to retry with. A
 * transport failure or a 5xx says nothing about the session.
 * @param error - the failure a session operation threw.
 * @returns true when the reader must sign in again.
 */
export function isSessionRefusal(error: unknown): boolean {
  return error instanceof AevenApiError && (error.status === 400 || error.status === 401)
}
