/** Notion connector: the hosted MCP server a Notion grant mounts, and which of its tools only read. */

/**
 * Notion's hosted MCP server over Streamable HTTP. The Aeven API requests every Notion grant for
 * this resource, so its access tokens are accepted here and nowhere else.
 */
export const NOTION_MCP_ENDPOINT = 'https://mcp.notion.com/mcp'

/**
 * Notion tools that only read the workspace, as Notion's published tool reference classifies
 * them. Every other tool changes something other members see — creating, updating, moving,
 * duplicating, trashing, or restoring pages and databases; views; comments, reactions, and
 * suggested edits; uploads, attachments, and folders — and so does any tool Notion adds later.
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
 * Whether a Notion tool only reads, so it runs without asking.
 * @param tool - the tool's name as Notion serves it, without the connector prefix.
 * @returns true for a read listed in {@link NOTION_READ_TOOLS}.
 */
export function isNotionReadTool(tool: string): boolean {
  return NOTION_READ_TOOLS.has(tool)
}
