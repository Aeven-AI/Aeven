/**
 * Vendor-hosted MCP connectors: Notion, Vercel, Atlassian, monday.com, and Stripe. Each mounts
 * its vendor's own MCP server over Streamable HTTP with a grant the Aeven API holds.
 */

import type { ConnectorProvider } from './types.ts'

/** Providers whose connector mounts the vendor's hosted MCP server. */
export type HostedMcpProvider = 'notion' | 'vercel' | 'atlassian' | 'monday' | 'stripe'

/**
 * Each provider's MCP endpoint. The Aeven API requests every grant for the vendor's MCP server,
 * so the access tokens it issues are accepted there and nowhere else.
 */
export const HOSTED_MCP_ENDPOINTS: Readonly<Record<HostedMcpProvider, string>> = {
  notion: 'https://mcp.notion.com/mcp',
  vercel: 'https://mcp.vercel.com',
  atlassian: 'https://mcp.atlassian.com/v1/mcp',
  monday: 'https://mcp.monday.com/mcp',
  stripe: 'https://mcp.stripe.com',
}

/**
 * Whether a provider's connector mounts a vendor-hosted MCP server.
 * @param provider - the connector's provider.
 * @returns true for a key of {@link HOSTED_MCP_ENDPOINTS}.
 */
export function isHostedMcp(provider: ConnectorProvider): provider is HostedMcpProvider {
  return Object.hasOwn(HOSTED_MCP_ENDPOINTS, provider)
}

/**
 * Notion tools that only read the workspace, as Notion's published tool reference classifies
 * them; for Notion this list decides instead of the server's own `readOnlyHint`. Every other
 * tool changes something other members see — creating, updating, moving, duplicating,
 * trashing, or restoring pages and databases; views; comments, reactions, and suggested
 * edits; uploads, attachments, and folders — and so does any tool Notion adds later.
 */
const NOTION_READ_TOOLS: ReadonlySet<string> = new Set([
  'notion-search', 'notion-connector-search', 'notion-fetch',
  'notion-list-private-pages', 'notion-list-shared-pages', 'notion-list-favorite-pages', 'notion-list-recent-pages',
  'notion-list-page-backlinks', 'notion-query-meeting-notes',
  'notion-get-self', 'notion-get-teams', 'notion-get-groups', 'notion-get-users', 'notion-get-tool-access',
  'notion-get-async-task', 'notion-query-data-sources', 'notion-query-multiple-data-sources',
  'notion-get-version-changes', 'notion-view-version', 'notion-get-comments', 'notion-get-suggested-edit',
  'notion-download-attachment', 'notion-get-file-download-urls',
])

/**
 * Whether one hosted-MCP tool only reads, so it runs without asking. Notion's reads come from
 * its published list; every other vendor's server says so itself with MCP's `readOnlyHint`,
 * and a tool its server does not mark asks first.
 * @param provider - the connector's provider.
 * @param tool - the tool's name as the vendor serves it, without the connector prefix.
 * @param readOnlyHint - whether the vendor's server annotated the tool `readOnlyHint: true`.
 * @returns true when the call may run without approval.
 */
export function isHostedMcpReadTool(provider: HostedMcpProvider, tool: string, readOnlyHint: boolean): boolean {
  return provider === 'notion' ? NOTION_READ_TOOLS.has(tool) : readOnlyHint
}

/** What the approval prompt tells the user about one vendor's changes. */
export const HOSTED_MCP_APPROVAL_REASONS: Readonly<Record<HostedMcpProvider, string>> = {
  notion: 'Approve this change to your connected Notion workspace. Other members can see it.',
  vercel: 'Approve this change to your connected Vercel account. It can affect live projects and deployments.',
  atlassian: 'Approve this change to your connected Atlassian site. It appears as you in Jira or Confluence.',
  monday: 'Approve this change to your connected monday.com account. Other members can see it.',
  stripe: 'Approve this action on your connected Stripe account. It can change live payments, customers, or billing.',
}
