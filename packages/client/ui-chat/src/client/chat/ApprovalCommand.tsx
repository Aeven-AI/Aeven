/** Chat-owned approval preview from correlated shell or connector arguments. */
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-approval/client'
import type { ToolCallBlock } from '@aeven/client-ui-conversation/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

interface ApprovalToolCall {
  readonly callId: string
  readonly argsRaw: string
}

/**
 * Extract a shell command from a correlated Tool call when its arguments carry one.
 * @param call - Tool call arguments, when a correlated call exists.
 * @returns command text, or undefined for absent, malformed, or unrelated arguments.
 */
export function commandOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    return typeof args.command === 'string' ? args.command : undefined
  } catch {
    return undefined
  }
}

/** Find a correlated call, including calls dispatched inside another tool. */
function findCall(root: ToolCallBlock, callId: string): ToolCallBlock | undefined {
  if (root.callId === callId) return root
  for (const child of root.subCalls) {
    const found = findCall(child, callId)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Render the exact command or connector arguments of a correlated Chat call.
 * @param props - Approval identity, Chat selector, and localized detail labels.
 * @returns Plain-text action content with its destination and remaining arguments.
 */
export function ApprovalCommand({ callId, useChat, t }: PropsRuntime<'conversation.approval.detail'> & PropsLocale<'approval'>) {
  const call = useChat((snapshot) => {
    for (const node of snapshot.nodes.values()) {
      const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
      if (root !== undefined) {
        const found = findCall(root, callId)
        if (found !== undefined) return found
      }
    }
    return undefined
  })
  if (call === undefined || 'kind' in call) return null
  if (!call.name.startsWith('mcp__')) {
    const command = commandOf(call)
    return command === undefined ? null : <code>{command}</code>
  }
  let args: unknown
  try {
    args = JSON.parse(call.argsRaw)
  } catch {
    // Incomplete streamed JSON remains visible for review as received.
    return call.argsRaw
  }
  if (args === null || typeof args !== 'object' || Array.isArray(args)) return call.argsRaw
  const contentKeys = new Set(['text', 'message', 'body', 'content'])
  const destinationKeys = new Set(['to', 'recipient', 'recipient_id', 'chat_id', 'jid', 'phone', 'phone_number'])
  const entries = Object.entries(args).sort(([left], [right]) => {
    const priority = (key: string): number =>
      destinationKeys.has(key) || key === 'channel' || key === 'channel_id' ? 0
        : key === 'subject' ? 1 : contentKeys.has(key) ? 2 : 3
    return priority(left) - priority(right)
  })
  return <>
    {entries.map(([key, value]) => {
      const label = contentKeys.has(key) ? t('message')
        : destinationKeys.has(key) ? t('to')
          : key === 'channel' || key === 'channel_id' ? t('channel')
            : key === 'subject' ? t('subject') : key.replaceAll('_', ' ')
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
      return <div key={key}><strong>{label}</strong>{'\n'}{text}{'\n\n'}</div>
    })}
  </>
}
