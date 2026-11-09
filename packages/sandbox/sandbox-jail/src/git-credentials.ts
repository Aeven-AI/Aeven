/**
 * The registry of Git credential sources for the jail's egress proxy. A plugin that holds an account's credential
 * for a Git host, such as a connected GitHub account, registers a source; the provider consults the sources when
 * the proxy forwards that account's Git request, so the credential reaches the Git host without entering a jail.
 *
 * @module @aeven/sandbox-jail/git-credentials
 */

/** One source: given an account path segment and a Git host, the token it holds for them, or undefined. */
type Source = (account: string, host: string) => Promise<string | undefined>

/** The sources registered on one Host, published as `ctx.sandboxGitCredentials`. */
export class GitCredentials {
  private readonly sources = new Set<Source>()

  /**
   * Add a source.
   * @param source - consulted for every Git request the proxy forwards, with the account path segment of the jail
   * that made the request and the Git host, e.g. `github.com`. It returns a token the host accepts as the password
   * of `x-access-token`, or undefined when it has none for that account and host.
   * @returns the disposer that removes it.
   */
  register(source: (account: string, host: string) => Promise<string | undefined>): () => void {
    this.sources.add(source)
    return () => { this.sources.delete(source) }
  }

  /**
   * The first credential any source holds; a source that throws is skipped, so one failing integration leaves a
   * public repository reachable.
   * @param account - the account path segment.
   * @param host - the Git host.
   * @param onError - reports a source that threw.
   * @returns the token, or undefined when no source has one.
   */
  async resolve(account: string, host: string, onError: (error: unknown) => void): Promise<string | undefined> {
    for (const source of this.sources) {
      try {
        const token = await source(account, host)
        if (token !== undefined && token !== '') return token
      } catch (error) {
        onError(error)
      }
    }
    return undefined
  }
}
