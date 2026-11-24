/**
 * Salesforce connector: an org's hosted MCP server, reached with the External Client App its
 * administrator created. Salesforce has no shared application, so the user brings that app's
 * consumer key (and secret, when the app requires one) to the consent the Aeven API runs.
 */

import { z } from 'zod'

/**
 * A Salesforce My Domain host: production, sandbox, scratch, or Developer Edition. The Aeven API
 * applies the same rule, since it sends codes, tokens, and the consumer secret to this host.
 */
const SALESFORCE_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?(?:\.(?:sandbox|scratch|develop))?\.my\.salesforce\.com$/

/** What Settings submits to connect an org; the secret is write-only and never returned. */
export const salesforceRequestSchema = z.object({
  domain: z.string().trim().toLowerCase().transform(value => value.replace(/^https:\/\//, '').replace(/\/+$/, '')).pipe(z.string().regex(SALESFORCE_DOMAIN)),
  clientId: z.string().trim().regex(/^[A-Za-z0-9._]{20,256}$/),
  clientSecret: z.string().trim().regex(/^[A-Za-z0-9]{16,128}$/).optional(),
})

/**
 * The hosted MCP server one org's connector mounts. Sandbox and scratch orgs are served under
 * `sandbox`, every other org under `platform`.
 * @param domain - the org's My Domain host, as {@link salesforceRequestSchema} normalizes it.
 * @param server - the hosted server's name, such as `sobject-all`; the org's administrator must have enabled it.
 * @returns the server's Streamable HTTP endpoint.
 */
export function salesforceMcpEndpoint(domain: string, server: string): string {
  const environment = /\.(?:sandbox|scratch)\.my\.salesforce\.com$/.test(domain) ? 'sandbox' : 'platform'
  return `https://api.salesforce.com/platform/mcp/v1/${environment}/${encodeURIComponent(server)}`
}
