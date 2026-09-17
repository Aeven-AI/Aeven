/**
 * Vocabulary for the authenticated-user seam.
 * @module @aeven/identity-user/types
 */

/**
 * One authenticated person, as the resolving authority reports them.
 *
 * Only `id` is guaranteed: it is what a subsystem keys work on, and the only
 * field an authority must be able to produce. Everything else is presentation
 * an authority may or may not hold, so a consumer that needs a display name
 * must handle its absence rather than assume the profile was fetched.
 */
export interface User {
  /** Stable identifier from the authenticating authority. */
  readonly id: string
  readonly email?: string
  readonly displayName?: string
  readonly avatarUrl?: string
}

/**
 * The facts an authority is given to identify the caller.
 *
 * Headers only, because that is what both AVN transports have in common: an
 * HTTP request carries the credential in `authorization`, and a WebSocket
 * upgrade carries it in `cookie`. Nothing here is decoded — an authority reads
 * whichever it recognizes.
 */
export interface IdentityRequest {
  readonly headers: Headers | Readonly<Record<string, string | readonly string[] | undefined>>
}

/**
 * An authority that turns a request's credential into the person who made it.
 *
 * Resolution is synchronous by contract. AVN consults it inside the request
 * fence that already runs for every HTTP request and every WebSocket upgrade,
 * and that fence answers before dispatch; an authority that must call out to a
 * network service cannot be consulted there.
 */
export interface UserResolver {
  /** Registry key, so a composition naming one authority selects it. */
  readonly id: string
  /**
   * Identify the caller.
   * @param request - the credential-bearing headers.
   * @returns the authenticated user, or undefined when the credential is
   * absent, malformed, or expired. The reason is deliberately not reported:
   * AVN answers 401 either way, and distinguishing them for a caller that
   * failed to authenticate describes the credential to whoever supplied it.
   */
  resolve(request: IdentityRequest): User | undefined
}
