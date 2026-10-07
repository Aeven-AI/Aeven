/**
 * Types for the `mcp/servers` report: which MCP servers an agent's tools can
 * come from, and whether each one is serving.
 * @module @aeven/mcp-client/src/types
 */

import type { Agent } from '@aeven/agent'
import type { Scoped } from '@aeven/scope'
import type { ConnectionStatus } from './connection.ts'

/** One MCP server as reported to an agent's tool index. */
export interface McpServerReport extends ConnectionStatus {
  /** The configured `serverName`. */
  serverName: string
  /** Prefix of every public tool name this server registers (`mcp__<serverName>__`). */
  toolPrefix: string
  /** Configured description of what the server's tools act on. */
  title?: string
  /** Connect now with a fresh attempt budget; resolves with the resulting status and never rejects. */
  restart(): Promise<ConnectionStatus>
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * List the MCP servers one agent's tools can come from. Every mounted
     * mcp-client instance appends its own report after `next()`.
     * @param request.agent - the agent whose tool sources are listed.
     * Scope-filtered dispatch (`@aeven/scope`): agent-scoped listeners receive only that agent.
     * @mode waterfall
     */
    'mcp/servers'(this: Scoped<Agent>, request: { agent: Agent }, next: () => Promise<McpServerReport[]>): Promise<McpServerReport[]>
  }
}
