/** Generated-image and generated-video call registration and replayable Turn presentation indexes. @module */
import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@aeven/llm/types'
import type { ConversationNodeDefinition } from '@aeven/client-ui-conversation/client'
import type { GeneratedImages } from '@aeven/client-ui-chat/client'
import { isAppendSurfaceEvent } from '@aeven/session/surface'
import type {} from '@aeven/tools/types'

/** Image tools whose atomic views own the displayed output. */
export const IMAGE_TOOLS = ['generate_image', 'codex_image_generate', 'codex_image_edit', 'grok_imagine_image'] as const

/** Video tools whose atomic views own the displayed clip. */
export const VIDEO_TOOLS = ['generate_video'] as const

/**
 * Every generating tool the index records. A recorded call stays visible
 * outside the collapsed process group, so its frame shows at the call.
 */
const GENERATING_TOOLS: readonly string[] = [...IMAGE_TOOLS, ...VIDEO_TOOLS]

interface ImageState extends GeneratedImages {
  readonly names: ReadonlyMap<string, string>
}

function empty(): ImageState {
  return { names: new Map(), callIds: new Set(), attachmentIds: new Set(), sources: new Set() }
}

function record(state: ImageState, callId: string, name: string, content?: readonly ContentBlock[], meta?: unknown): ImageState {
  if (!GENERATING_TOOLS.includes(name)) return state
  const names = new Map(state.names)
  names.set(callId, name)
  const callIds = new Set(state.callIds).add(callId)
  const attachmentIds = new Set(state.attachmentIds)
  const sources = new Set(state.sources)
  for (const block of content ?? []) {
    if (block.type === 'image') attachmentIds.add(String(block.attachment.attachmentId))
    if (block.type === 'text') {
      let value: unknown
      try { value = JSON.parse(block.text) } catch {
        // Non-JSON result summaries contain no structured attachment paths.
        continue
      }
      recordSources(value, sources)
    }
  }
  recordSources(meta, sources)
  return { names, callIds, attachmentIds, sources }
}

function recordSources(value: unknown, sources: Set<string>): void {
  if (typeof value !== 'object' || value === null) return
  const row = value as { path?: unknown; workspacePaths?: unknown; imagePaths?: unknown; images?: unknown }
  if (typeof row.path === 'string') sources.add(row.path)
  for (const paths of [row.workspacePaths, row.imagePaths]) {
    if (Array.isArray(paths)) for (const path of paths) if (typeof path === 'string') sources.add(path)
  }
  if (Array.isArray(row.images)) {
    for (const image of row.images) {
      if (typeof image === 'object' && image !== null && 'path' in image && typeof image.path === 'string') sources.add(image.path)
    }
  }
}

const definition: ConversationNodeDefinition<ImageState> = {
  kind: 'generated-images',
  match: (event, location) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type !== 'tool/call' && event.type !== 'tool/result'
      && event.type !== 'tool/code-dispatch-start' && event.type !== 'tool/code-dispatch') return null
    if (event.type === 'tool/result' && !isAppendSurfaceEvent(event)) return null
    if (location.kind !== 'turn' && location.kind !== 'step') return null
    return { id: String(location.turn.turn), role: 'update' }
  },
  start: () => empty(),
  update: ({ state }, { event }) => {
    if (event.type === 'tool/call') return record(state, String(event.data.callId), event.data.name)
    if (event.type === 'tool/result') {
      const id = String(event.data.message.source.callId)
      return record(state, id, state.names.get(id) ?? '', event.data.message.content[0].isError === true ? undefined : event.data.message.content[0].content, event.data.meta)
    }
    if (event.type === 'tool/code-dispatch-start' || event.type === 'tool/code-dispatch') {
      return record(state, event.data.subCallId, event.data.name,
        event.type === 'tool/code-dispatch' && !event.data.isError ? event.data.content : undefined)
    }
    return state
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn') return null
    const state = context.state ?? context.matches.reduce((current, match) => definition.update({ ...context, state: current }, match), empty())
    if (previous?.kind === 'turn' && previous.key === 'generated-images'
      && previous.value.callIds === state.callIds && previous.value.attachmentIds === state.attachmentIds
      && previous.value.sources === state.sources) return previous
    const location = context.start?.location ?? context.matches[0]?.location
    if (location?.kind !== 'turn' && location?.kind !== 'step') return null
    return { kind: 'turn', turn: location.turn.turn, key: 'generated-images', value: state }
  },
}

/**
 * Register generated-image presentation indexes with the owning plugin's lifetime.
 * @param ctx - Client context carrying the Conversation service.
 */
export function registerGeneratedImages(ctx: Context): void {
  ctx.uiConversation.events.register(definition)
}
