/**
 * Fixtures shared by the read-aloud specs: the dictionary seat, Chat snapshots holding fixed
 * conversation nodes, and the selector hooks the renderer would bind from the plugin's inject face.
 */
import type { ChatSnapshot } from '@aeven/client-ui-chat/client'
import type {
  AssistantBlock, AssistantMessageNode, ConversationNode, PartialAssistant, ToolResultNode,
} from '@aeven/client-ui-conversation/client'
import { en } from '../src/client/locales.ts'
import type { ReadAloudSnapshot } from '../src/client/engine.ts'

/** Translate function over a dictionary, resolving `{name}` template params. */
export type Translate = (key: string, params?: Record<string, unknown>) => string

/**
 * The `t` seat the locale plugin would inject: dictionary lookup with template params.
 * @param dictionary - namespace dictionary to read; English by default.
 * @returns the translate function.
 */
export function makeT(dictionary: Record<string, string> = en): Translate {
  return (key, params) => (dictionary[key] ?? key).replace(/\{(\w+)\}/g, (match, name: string) =>
    (params !== undefined && name in params ? String(params[name]) : match))
}

/**
 * A Chat snapshot carrying one live partial and a fixed node window.
 * @param partial - in-flight assistant step, or null when no step is streaming.
 * @param nodes - settled conversation nodes in log order.
 * @returns the snapshot.
 */
export function chatSnapshot(
  partial: PartialAssistant | null,
  nodes: readonly ConversationNode[] = [],
): ChatSnapshot {
  const empty = (): undefined => undefined
  return {
    order: [],
    nodes: {
      get: empty,
      source: () => ({ getSnapshot: empty, subscribe: () => () => {} }),
      processSource: () => ({ getSnapshot: empty, subscribe: () => () => {} }),
      values: () => [],
    },
    locations: { getTurn: () => [], getStep: () => [] },
    timeline: { turnOrder: [], turns: new Map() },
    legacy: { nodes, turnTimings: new Map(), turnEnds: new Map(), partial, runningCalls: [] },
  }
}

/**
 * A `useChat` seat over one fixed snapshot.
 * @param snapshot - the Chat snapshot every selector reads.
 * @returns the selector hook.
 */
export function useChatOf(snapshot: ChatSnapshot): (selector: (value: ChatSnapshot) => unknown) => unknown {
  return selector => selector(snapshot)
}

/**
 * A `useReadAloud` seat over one fixed snapshot.
 * @param snapshot - the read-aloud snapshot every selector reads.
 * @returns the selector hook.
 */
export function useReadAloudOf(
  snapshot: ReadAloudSnapshot,
): (selector: (value: ReadAloudSnapshot) => unknown) => unknown {
  return selector => selector(snapshot)
}

/**
 * A read-aloud snapshot listing channels in one or more published states.
 * @param states - channel ids per state.
 * @returns the snapshot.
 */
export function readAloudState(states: Partial<ReadAloudSnapshot> = {}): ReadAloudSnapshot {
  return {
    enabled: states.enabled ?? [],
    loading: states.loading ?? [],
    speaking: states.speaking ?? [],
    failed: states.failed ?? [],
  }
}

/**
 * One in-flight assistant step.
 * @param text - the step's streaming prose.
 * @param turn - owning turn.
 * @param step - owning step.
 * @param blocks - complete block list, when the step carries more than prose.
 * @returns the partial.
 */
export function partialStep(
  text: string,
  turn = 1,
  step = 1,
  blocks?: readonly AssistantBlock[],
): PartialAssistant {
  return { turn, step, blocks: blocks ?? [{ kind: 'text', text }] }
}

/**
 * A settled assistant message.
 * @param messageId - message identity the action strip addresses.
 * @param blocks - the message's blocks.
 * @param seq - log position.
 * @returns the node.
 */
export function assistantNode(
  messageId: string,
  blocks: readonly AssistantBlock[],
  seq = 1,
): AssistantMessageNode {
  return {
    kind: 'assistant',
    seq,
    messageId: messageId as AssistantMessageNode['messageId'] & string,
    time: 0,
    turn: 1,
    step: 1,
    blocks,
  }
}

/**
 * A settled tool result.
 * @param seq - log position.
 * @param name - called tool name, or null when the call head is outside the window.
 * @param argsRaw - call arguments as the model sent them.
 * @returns the node.
 */
export function toolResultNode(seq: number, name: string | null, argsRaw: string): ToolResultNode {
  return {
    kind: 'tool-result',
    seq,
    time: 0,
    callId: `call-${String(seq)}`,
    call: name === null ? null : { name, argsRaw },
    callTime: null,
    content: [],
    isError: false,
    subCalls: [],
  }
}
