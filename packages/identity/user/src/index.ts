/**
 * The authenticated-user seam.
 *
 * DSH subsystems read `ctx.identityUsers` to learn who is acting. They never
 * see a cookie, a bearer token, a login page, or an expiry: an authority
 * package registers a {@link UserResolver}, and this service is the whole of
 * what the rest of the harness knows about authentication.
 *
 * With no authority registered the service resolves nobody, and the request
 * fence leaves its existing behaviour untouched — a stock harness stays
 * single-user and unauthenticated without carrying an Aeven-shaped hole.
 * @module @aeven/identity-user
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import type { IdentityRequest, User, UserResolver } from './types.ts'

export type { IdentityRequest, User, UserResolver } from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Authenticated-user identity for the current request. */
    identityUsers: IdentityUsers
  }
}

/**
 * Registry of authorities, and the resolution every consumer goes through.
 */
export class IdentityUsers extends Service {
  private readonly resolvers = new Map<string, UserResolver>()

  /** @param ctx - the providing plugin's context. */
  constructor(ctx: Context) {
    super(ctx, 'identityUsers')
  }

  /**
   * Register one authority.
   * @param resolver - the authority to add.
   * @returns the disposer removing it.
   */
  registerResolver(resolver: UserResolver): () => void {
    if (this.resolvers.has(resolver.id)) {
      throw new Error(`identity-user: a resolver named ${JSON.stringify(resolver.id)} is already registered`)
    }
    this.resolvers.set(resolver.id, resolver)
    return () => { this.resolvers.delete(resolver.id) }
  }

  /** Whether any authority is registered; false leaves requests unauthenticated. */
  get enforcing(): boolean {
    return this.resolvers.size > 0
  }

  /**
   * Identify the caller through the registered authorities.
   *
   * The first authority that recognizes the credential answers. Order is
   * registration order, which a composition controls by the order it mounts
   * them; nothing here ranks authorities, because a deployment with two that
   * disagree about one credential has a composition problem, not a resolution
   * problem.
   * @param request - the credential-bearing headers.
   * @returns the authenticated user, or undefined when none recognized it.
   */
  resolve(request: IdentityRequest): User | undefined {
    for (const resolver of this.resolvers.values()) {
      const user = resolver.resolve(request)
      if (user !== undefined) return user
    }
    return undefined
  }
}

export default IdentityUsers
