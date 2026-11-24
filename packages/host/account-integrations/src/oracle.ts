/**
 * Oracle Cloud connector: a tenancy's managed MCP server, reached with the confidential application
 * its administrator created in an OCI Identity Domain. Oracle has no shared application, so the user
 * brings the server URL, the Identity Domain, and that application's client id and secret.
 */

import { z } from 'zod'

/**
 * An OCI Identity Domain host. The Aeven API applies the same rule, since it sends codes, tokens,
 * and the client secret to this host.
 */
const ORACLE_DOMAIN = /^idcs-[a-f0-9]{32}(?:\.[a-z0-9-]+)?\.identity\.oraclecloud\.com$/

/** A managed MCP server URL as the OCI console shows it: HTTPS on an `oraclecloud.com` host. */
const serverUrl = z.string().trim().pipe(z.url({ protocol: /^https$/, hostname: /^(?:[a-z0-9-]+\.)+oraclecloud\.com$/ }))

/** What Settings submits to connect a tenancy's MCP server; the secret is write-only and never returned. */
export const oracleRequestSchema = z.object({
  server: serverUrl,
  domain: z.string().trim().toLowerCase().transform(value => value.replace(/^https:\/\//, '').replace(/\/.*$/, '')).pipe(z.string().regex(ORACLE_DOMAIN)),
  clientId: z.string().trim().regex(/^[A-Za-z0-9_-]{16,128}$/),
  clientSecret: z.string().trim().regex(/^[A-Za-z0-9._-]{16,256}$/).optional(),
})
