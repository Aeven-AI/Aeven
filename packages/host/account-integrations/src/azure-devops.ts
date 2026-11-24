/**
 * Azure DevOps connector: the hosted MCP server of one Azure DevOps organization, reached with a
 * Microsoft work or school account through the Aeven API's Microsoft application.
 */

import { z } from 'zod'

/** An Azure DevOps organization name: letters, digits, and inner hyphens, at most 50 characters. */
const ORGANIZATION = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/

/**
 * What Settings submits to connect an organization: its name, its `dev.azure.com` URL, or its
 * legacy `<organization>.visualstudio.com` host.
 */
export const azureDevOpsRequestSchema = z.object({
  organization: z.string().trim().toLowerCase().transform(value => value
    .replace(/^https?:\/\//, '')
    .replace(/^dev\.azure\.com\//, '')
    .replace(/\.visualstudio\.com(?:\/.*)?$/, '')
    .replace(/\/.*$/, '')).pipe(z.string().regex(ORGANIZATION)),
})

/**
 * The hosted MCP server one organization's connector mounts.
 * @param organization - the organization name, as {@link azureDevOpsRequestSchema} normalizes it.
 * @returns the server's Streamable HTTP endpoint.
 */
export function azureDevOpsMcpEndpoint(organization: string): string {
  return `https://mcp.dev.azure.com/${encodeURIComponent(organization)}`
}
