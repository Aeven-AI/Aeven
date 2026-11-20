/** Maps tool names to the connector that serves them, so a run can refuse connectors its bot is not bound to. */
import { CONNECTOR_IDS } from './domain.ts'
import type { ConnectorBinding, ConnectorId } from './types.ts'

/** Connector tool names: `mcp__<provider>_<first 8 hex digits of the connector id>__<tool>`, as account integrations mount them. */
const CONNECTOR_TOOL_NAME = /^mcp__([a-z-]+)_[a-f0-9]{8}__/

/**
 * The connector that serves one tool.
 * @param toolName - the tool the run calls.
 * @returns the connector id, or undefined for a tool no connector serves.
 */
export function connectorOf(toolName: string): ConnectorId | undefined {
  if (toolName.startsWith('mail_')) return 'email'
  const provider = CONNECTOR_TOOL_NAME.exec(toolName)?.[1]
  return CONNECTOR_IDS.find(id => id === provider)
}

/**
 * Whether a bot bound to `binding` may use one connector.
 * @param binding - the bot's connectors.
 * @param connector - the connector a tool belongs to.
 * @returns true for `all` or a listed connector.
 */
export function bound(binding: ConnectorBinding, connector: ConnectorId): boolean {
  return binding === 'all' || binding.includes(connector)
}

/**
 * Refusal the model reads when a run calls a connector its bot is not bound to.
 * @param binding - the bot's connectors.
 * @param toolName - the tool the run called.
 * @returns the refusal, or undefined when the call may proceed.
 */
export function connectorRefusal(binding: ConnectorBinding, toolName: string): string | undefined {
  const connector = connectorOf(toolName)
  if (connector === undefined || bound(binding, connector)) return undefined
  const allowed = binding === 'all' || binding.length === 0 ? 'none' : binding.join(', ')
  return `This bot is not connected to ${connector}. Its connectors are: ${allowed}. Only its owner can change them.`
}
