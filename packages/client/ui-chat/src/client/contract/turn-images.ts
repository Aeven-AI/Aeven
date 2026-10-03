import type { ContentBlock } from '@aeven/llm/types'
import type { MessageImageSource } from '@aeven/client-ui-conversation/client'
import type { ChatNode } from './chat-nodes.ts'
import { isSettledTool } from './chat-nodes.ts'
import type {} from '../conversation-nodes/assistant.ts'
import type {} from '../conversation-nodes/message.ts'
import type {} from '../conversation-nodes/tool.ts'

/** Identity of one image source, for the per-Turn dedupe key. */
function sourceKey(source: MessageImageSource): string {
  return 'attachment' in source ? String(source.attachment.attachmentId) : source.preview.url
}

/** Durable image sources cited by a content block list, in order. */
function contentImages(content: readonly ContentBlock[]): readonly MessageImageSource[] {
  const sources: MessageImageSource[] = []
  for (const block of content) {
    if (block.type !== 'image') continue
    sources.push({ attachment: block.attachment })
  }
  return sources
}

/** Image sources a settled Tool call and its recursive children produced, in dispatch order. */
function toolImages(node: Extract<ChatNode, { kind: 'tool-call' }>): readonly MessageImageSource[] {
  const sources: MessageImageSource[] = []
  const visit = (block: Parameters<typeof isSettledTool>[0]): void => {
    if (isSettledTool(block)) {
      if (!block.isError) sources.push(...contentImages(block.content))
    }
    for (const child of block.subCalls) visit(child)
  }
  visit(node.data.root)
  return sources
}

/** Image sources one Chat node puts on screen, in log order. */
function nodeImages(node: ChatNode): readonly MessageImageSource[] {
  if (node.kind === 'assistant-step') {
    return node.data.blocks.flatMap(block => block.kind === 'image' ? [{ attachment: block.attachment }] : [])
  }
  if (node.kind === 'tool-call') return toolImages(node)
  if (node.kind === 'user' || node.kind === 'steering') return contentImages(node.data.content)
  return []
}

/** Turn a Chat node belongs to, or undefined for a node without Turn coordinates. */
function nodeTurn(node: ChatNode): number | undefined {
  const { location } = node
  return location.kind === 'turn' || location.kind === 'step' ? location.turn.turn : undefined
}

/**
 * Every image one Turn puts on screen, in log order, keyed by Turn number.
 *
 * The gallery's navigation scope: one Turn's images reach each other with
 * previous/next even though they render in separate rows — a user message's
 * attachments, a Tool result's images, and the Assistant's own image blocks.
 * An image that several rows cite is listed once, at its first position.
 *
 * @param nodes - the Session's Chat nodes in flow order.
 * @returns the Turn's image sources, or an absent entry for a Turn with none.
 */
export function turnImagesOf(nodes: readonly ChatNode[]): ReadonlyMap<number, readonly MessageImageSource[]> {
  const byTurn = new Map<number, MessageImageSource[]>()
  const seen = new Map<number, Set<string>>()
  for (const node of nodes) {
    const turn = nodeTurn(node)
    if (turn === undefined) continue
    const keys = seen.get(turn) ?? new Set<string>()
    seen.set(turn, keys)
    const sources = byTurn.get(turn) ?? []
    byTurn.set(turn, sources)
    for (const source of nodeImages(node)) {
      const key = sourceKey(source)
      if (keys.has(key)) continue
      keys.add(key)
      sources.push(source)
    }
  }
  return byTurn
}
