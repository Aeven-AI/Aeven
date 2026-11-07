/** Keys under which atomic Tool views register. @module */

/** A connector tool name: `mcp__<provider>_<8 hex digits of the connector id>__<tool>`. */
const CONNECTOR_TOOL = /^mcp__([a-z-]+)_[0-9a-f]{8}__/

/**
 * The tool view key of a call. A connector tool's name carries its account's id, so its views register once under
 * `mcp__<provider>__<tool>` for every account of that provider; any other name is its own key.
 * @param toolName - the call's wire name.
 * @returns the key the call's view is registered under.
 */
export function toolViewKey(toolName: string): string {
  return toolName.replace(CONNECTOR_TOOL, 'mcp__$1__')
}
