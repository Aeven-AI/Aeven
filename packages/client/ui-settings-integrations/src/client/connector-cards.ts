/**
 * Which calls of a Turn draw a connector card, derived from the session log, so the conversation shows those calls
 * outside the folded process group the way it shows image calls.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ConversationNodeDefinition } from '@aeven/client-ui-conversation/client'
import type { ConnectorCards } from '@aeven/client-ui-chat/client'
import type {} from '@aeven/tools/types'

/** Tool view keys of the connector tools that draw a card: the WhatsApp message reads. */
export const CARD_TOOLS: readonly string[] = ['mcp__whatsapp__list_messages', 'mcp__whatsapp__get_message_context']

/**
 * The tool view key of a call, as the Tool tree computes it: a connector tool's account prefix removed, so
 * `mcp__whatsapp_1a2b3c4d__list_messages` is keyed `mcp__whatsapp__list_messages`.
 * @param toolName - the call's wire name.
 * @returns the key its view registers under.
 */
function toolViewKey(toolName: string): string {
  return toolName.replace(/^mcp__([a-z-]+)_[0-9a-f]{8}__/, 'mcp__$1__')
}

/** No card calls yet. */
function empty(): ConnectorCards {
  return { callIds: new Set() }
}

/**
 * Add one call when its tool draws a card.
 * @param state - the Turn's card calls so far.
 * @param callId - the call's id.
 * @param name - the call's wire tool name.
 * @returns the state, with the call added when its tool draws a card.
 */
function record(state: ConnectorCards, callId: string, name: string): ConnectorCards {
  if (!CARD_TOOLS.includes(toolViewKey(name)) || state.callIds.has(callId)) return state
  return { callIds: new Set(state.callIds).add(callId) }
}

/**
 * The Turn a projected location belongs to.
 * @param location - a matched event's location, or undefined.
 * @returns the Turn number, or undefined outside a Turn.
 */
function turnOf(location: { readonly kind: string; readonly turn?: { readonly turn: number } } | undefined): number | undefined {
  return location !== undefined && (location.kind === 'turn' || location.kind === 'step') ? location.turn?.turn : undefined
}

const definition: ConversationNodeDefinition<ConnectorCards> = {
  kind: 'connector-cards',
  match: (event, location) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    const turn = event.type === 'tool/call' || event.type === 'tool/code-dispatch-start' ? turnOf(location) : undefined
    return turn === undefined ? null : { id: String(turn), role: 'update' }
  },
  start: () => empty(),
  update: ({ state }, { event }) => {
    if (event.type === 'tool/call') return record(state, String(event.data.callId), event.data.name)
    if (event.type === 'tool/code-dispatch-start') return record(state, event.data.subCallId, event.data.name)
    return state
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn') return null
    let state = context.state
    if (state === undefined) {
      // Without a running state, the Turn's matches are replayed from an empty index.
      state = empty()
      for (const match of context.matches) state = definition.update({ ...context, state }, match)
    }
    const same = previous?.kind === 'turn' && previous.key === 'connector-cards' && previous.value.callIds === state.callIds
    if (same) return previous
    const turn = turnOf(context.start?.location ?? context.matches[0]?.location)
    return turn === undefined ? null : { kind: 'turn', turn, key: 'connector-cards', value: state }
  },
}

/**
 * Register the Turn index of connector card calls.
 * @param ctx - a context holding the conversation projection service.
 */
export function registerConnectorCards(ctx: Context): void {
  ctx.uiConversation.events.register(definition)
}
