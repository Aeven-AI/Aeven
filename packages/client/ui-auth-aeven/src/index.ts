/**
 * Aeven authentication surface, node half.
 *
 * The empty apply exists so the plugin appears in a host cordis.yml; the
 * authentication screens ship through `exports["./client"]`, and the Host-side
 * authority that verifies credentials is `dsh-identity-user-aeven`.
 * @module @deepseek-ai/dsh-client-ui-auth-aeven
 */

/** Host plugin body — this surface has no host-side behavior. */
export function apply(): void {}
