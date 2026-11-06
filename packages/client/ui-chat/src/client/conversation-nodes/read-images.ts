/**
 * Turn-local index of the images `read_image` stored, by the path each was
 * read from. A reply that shows one of those paths as a Markdown image displays
 * the stored copy, which outlives the file: the model may delete or overwrite
 * it later in the Turn, and another device of the account cannot reach the
 * Host's folder at all.
 * @module
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ImageAttachmentRef } from '@aeven/attachment'
import type { ConversationMatch, ConversationNodeDefinition } from '@aeven/client-ui-conversation/client'
import type { ContentBlock } from '@aeven/llm/types'
import { isAppendSurfaceEvent } from '@aeven/session/surface'

/** Stored copies of the images the Turn read, keyed by the resolved path the tool reported. */
export interface ReadImages {
  /** The latest stored image read from each path. */
  readonly byPath: ReadonlyMap<string, ImageAttachmentRef>
}

declare module '@aeven/client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Images `read_image` stored during the Turn, by source path. */
    'read-images': ReadImages
  }
}

/** The envelope `read_image` opens its text result with (tool-fs `formatImageReadOutput`). */
const PATH_ELEMENT = /^<path>([^<]+)<\/path>/

interface ReadImagesState extends ReadImages {
  /** Pending `read_image` call ids, so only that tool's results are indexed. */
  readonly calls: ReadonlySet<string>
}

function empty(): ReadImagesState {
  return { calls: new Set(), byPath: new Map() }
}

function recordResult(state: ReadImagesState, content: readonly ContentBlock[]): ReadImagesState {
  let path: string | undefined
  let image: ImageAttachmentRef | undefined
  for (const block of content) {
    if (block.type === 'text') path ??= PATH_ELEMENT.exec(block.text)?.[1]
    if (block.type === 'image') image ??= block.attachment
  }
  if (path === undefined || image === undefined) return state
  const byPath = new Map(state.byPath).set(path, image)
  return { calls: state.calls, byPath }
}

/** Event types the index reads; a turn's start opens it. */
const INDEXED = new Set(['tool/call', 'tool/result'])

function step(state: ReadImagesState, event: ConversationMatch['event']): ReadImagesState {
  if (event.type === 'tool/call') {
    if (event.data.name !== 'read_image') return state
    return { calls: new Set(state.calls).add(String(event.data.callId)), byPath: state.byPath }
  }
  if (event.type !== 'tool/result') return state
  const result = event.data.message.content[0]
  const read = state.calls.has(String(event.data.message.source.callId)) && result.isError !== true
  return read ? recordResult(state, result.content) : state
}

const definition: ConversationNodeDefinition<ReadImagesState> = {
  kind: 'read-images',
  match: (event, location) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    const indexed = INDEXED.has(event.type) && (event.type !== 'tool/result' || isAppendSurfaceEvent(event))
    return indexed && (location.kind === 'turn' || location.kind === 'step')
      ? { id: String(location.turn.turn), role: 'update' }
      : null
  },
  start: () => empty(),
  update: ({ state }, { event }) => step(state, event),
  buildLocationData: (context, scope, previous) => {
    const turn = context.start?.location ?? context.matches[0]?.location
    if (scope !== 'turn' || (turn?.kind !== 'turn' && turn?.kind !== 'step')) return null
    const { byPath } = context.state ?? context.matches.reduce((state, match) => step(state, match.event), empty())
    return previous?.kind === 'turn' && previous.key === 'read-images' && previous.value.byPath === byPath
      ? previous
      : { kind: 'turn', turn: turn.turn.turn, key: 'read-images', value: { byPath } }
  },
}

/**
 * Register the read-image index with the owning plugin's lifetime.
 * @param ctx - owning UI Conversation context.
 */
export function registerReadImages(ctx: Context): void {
  ctx.uiConversation.events.register(definition)
}
