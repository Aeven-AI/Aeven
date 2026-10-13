/**
 * The MCP server the daemon serves: upstream's tool list plus the Aeven-owned tools upstream does
 * not ship — moderation, group administration, and raw schema access.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createServer } from '../source/src/server.ts'
import { registerApiTool } from './api.ts'
import { registerGroupTools } from './groups.ts'
import { registerModerationTools } from './moderation.ts'

/**
 * Build the server whose tools the connector mounts.
 * @returns the upstream server with the Aeven-owned tools registered on it.
 */
export function createTelegramServer(): McpServer {
  const server = createServer()
  registerModerationTools(server)
  registerGroupTools(server)
  registerApiTool(server)
  return server
}
