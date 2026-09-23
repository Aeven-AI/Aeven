/** Chat-only row visibility; durable events and trajectory inspection remain intact. */
import type { ChatNode } from './chat-nodes.ts'
import { skillInvocationName } from '../conversation-nodes/event-projection.ts'

/**
 * Exclude system prompts, permission commands and injected context from visible
 * Chat rows. A context message that records a user-invoked skill stays visible.
 * @param node - projected Chat node.
 * @returns whether the node contributes a visible Chat row.
 */
export function isVisibleChatNode(node: ChatNode): boolean {
  return node.visibility === 'visible'
    && node.kind !== 'system-prompt'
    && !(node.kind === 'command' && node.data.name === 'permission')
    && !(node.kind === 'context' && skillInvocationName(node.data.source) === null)
}
