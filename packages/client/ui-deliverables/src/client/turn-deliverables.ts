/**
 * Turn-scoped produced-file Definition and readers. Client-only and
 * model-free: paths come from successful first-party mutation calls and
 * verified generated-file result metadata, never the closing prose.
 */
import { isAppendSurfaceEvent } from '@aeven/session/surface'
import {
  basename, declaredOutputs, isRecord, mutationCalls, pathValue, resultText, settledMutation, sharedImages, storedCopies,
  type LineCounts, type MutationCall, type ProducedPath, type TurnDeliverables,
} from '@aeven/session-turn-outline/client'
import type { ProducedImages, TurnTailOwnerProps } from '@aeven/client-ui-chat/client'
import type { ConversationNodeDefinition } from '@aeven/client-ui-conversation/client'
import type { ImageAttachmentRef } from '@aeven/attachment'
import { fileKindOf, type MarkdownFileMentions } from '@aeven/client-ui-primitives'

export { basename }

/** One produced file of a turn, its mutations folded together. */
export interface ProducedFile {
  /** The path as the first mutation spelled it. */
  readonly path: string
  /** Whether the turn's first mutation of the path created the file. */
  readonly created: boolean
  /** Summed line counts, absent when any mutation of the path recorded none. */
  readonly counts?: LineCounts | undefined
  /** The latest stored copy of the file, for a reader who cannot open the Host's folders. */
  readonly attachmentId?: string | undefined
  /** The latest copy's full image reference, when the result shared the file as an image. */
  readonly image?: ImageAttachmentRef | undefined
}

/** Immutable produced-file facts published against one Turn. */
export interface DeliverablesTurnData {
  readonly produced: readonly ProducedPath[]
  /** Every image a successful tool result of the Turn shared, by attachment id, with its full reference. */
  readonly images?: ReadonlyMap<string, ImageAttachmentRef> | undefined
}

declare module '@aeven/client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful mutation paths accumulated in this Turn. */
    deliverables: DeliverablesTurnData
  }
}

interface DeliverablesState extends DeliverablesTurnData {
  readonly turn: number
  readonly calls: ReadonlyMap<string, readonly MutationCall[]>
}

/**
 * Files produced by one Turn data value.
 *
 * The source is the arguments of successful `write`, `edit`, and mutating
 * `str_replace_editor` calls and verified generated-file metadata, not the closing prose: a produced file must be
 * listed whether or not the model remembered to name it. Reads, unsupported
 * tools, malformed calls, and failed results contribute nothing. Paths keep
 * first-seen order and appear once, so a file written and then edited in the
 * same turn is one entry.
 *
 * The Conversation Location index owns turn membership before this function
 * runs, so paths cannot spill across turns and this derivation does not infer
 * boundaries from neighboring presentation Nodes.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced paths in first-seen order; empty when the turn wrote nothing.
 */
export function producedForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly string[] {
  return producedFilesForClosing(data, seq).map(file => file.path)
}

/**
 * Files produced by one Turn data value, each path's mutations folded into
 * one entry: created when the first mutation created it, with line counts
 * summed while every mutation recorded them. A Turn whose commands declared
 * output files lists only those: they are what the Turn delivers, and the
 * files a file tool wrote on the way, such as a resume's `cv.json`, are its
 * sources.
 * @param data - engine-published Deliverables data for one Turn.
 * @param seq - closing Assistant seq; later Tool settlements are excluded.
 * @returns Produced files in first-seen order; empty when the turn wrote nothing.
 */
export function producedFilesForClosing(
  data: Readonly<DeliverablesTurnData> | undefined,
  seq = Number.POSITIVE_INFINITY,
): readonly ProducedFile[] {
  if (data === undefined) return []
  const settled = data.produced.filter(produced => produced.seq <= seq)
  const declared = settled.filter(produced => produced.declared === true)
  const files = new Map<string, ProducedFile>()
  for (const produced of declared.length > 0 ? declared : settled) {
    const seen = files.get(produced.path)
    if (seen === undefined) {
      files.set(produced.path, {
        path: produced.path, created: produced.created, counts: produced.counts, attachmentId: produced.attachmentId, image: produced.image,
      })
      continue
    }
    const counts = seen.counts === undefined || produced.counts === undefined
      ? undefined
      : { added: seen.counts.added + produced.counts.added, deleted: seen.counts.deleted + produced.counts.deleted }
    files.set(produced.path, {
      ...seen,
      counts,
      attachmentId: produced.attachmentId ?? seen.attachmentId,
      image: produced.attachmentId === undefined ? seen.image : produced.image,
    })
  }
  // A copy shared by another result of the Turn, such as the image the agent viewed after writing it, is drawn too.
  return [...files.values()].map(file => file.image !== undefined || file.attachmentId === undefined
    ? file
    : { ...file, image: data.images?.get(file.attachmentId) })
}

/**
 * The Deliverables data the Host's `turnDeliverables` projection holds for one Turn.
 * @param value - the `turnDeliverables` projection value, treated as wire data.
 * @param turn - the Turn number.
 * @returns the Turn's projected data, or undefined when the projection lists no files for it.
 */
export function projectedTurnData(value: readonly TurnDeliverables[] | undefined, turn: number): DeliverablesTurnData | undefined {
  const entry = value?.find(candidate => candidate.turn === turn)
  return entry === undefined ? undefined : { produced: entry.produced }
}

/**
 * Match of the produced-files chain entry: the closing Turn's files, or the number of a Turn whose `turn/start`
 * the loaded window lacks, whose files only the `turnDeliverables` projection holds.
 */
export type ProducedFilesMatch = readonly ProducedFile[] | { readonly projectedTurn: number }

/**
 * Claim the turn-tail chain when its closing turn produced files, or when the loaded window holds the Turn's
 * closing message without its `turn/start`: the `deliverables` Definition starts from that event, so it has no data
 * for such a Turn, and the row reads the Turn's files from the projection instead.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns The match, or null to decline before mount.
 */
export function selectProducedFiles(owner: TurnTailOwnerProps): ProducedFilesMatch | null {
  const data = owner.turn.data.get('deliverables')
  if (data === undefined && owner.turn.start === undefined) return { projectedTurn: owner.turn.turn }
  const files = producedFilesForClosing(data, owner.seq)
  return files.length === 0 ? null : files
}

/** Turn-local successful mutation accumulator; it publishes no view Node. */
export const deliverablesDefinition: ConversationNodeDefinition<DeliverablesState> = {
  kind: 'deliverables',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call') return { id: String(event.data.turn), role: 'update' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('deliverables start requires turn/start')
    return { turn: match.event.data.turn, calls: new Map(), produced: [], images: new Map() }
  },
  update: (context, match) => {
    if (match.event.type === 'tool/call') {
      const calls = new Map(context.state.calls)
      calls.set(
        String(match.event.data.callId),
        mutationCalls(match.event.data.name, match.event.data.arguments),
      )
      return { ...context.state, calls }
    }
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    if (result.isError === true) return context.state
    const { seq, data: { meta } } = match.event
    const shared = sharedImages(result.content)
    const state = shared.size === 0 ? context.state : { ...context.state, images: new Map([...context.state.images ?? [], ...shared]) }
    const declared = declaredOutputs(seq, meta, result.content)
    if (declared !== undefined) return { ...state, produced: [...state.produced, ...declared] }
    const callId = String(match.event.data.message.source.callId)
    const calls = state.calls.get(callId)
    if (calls === undefined || calls.length === 0) return state
    const text = resultText(result.content)
    const produced = calls.map(call => ({ seq, path: call.path, ...settledMutation(call, text, meta) }))
    return { ...state, produced: [...state.produced, ...produced] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn'
      && previous.turn === context.state.turn
      && previous.key === 'deliverables'
      && previous.value.produced === context.state.produced
      && previous.value.images === context.state.images) return previous
    return {
      kind: 'turn',
      turn: context.state.turn,
      key: 'deliverables',
      value: { produced: context.state.produced, images: context.state.images },
    }
  },
}

/** One Turn's produced images while its results arrive. */
interface ProducedImagesState extends ProducedImages {
  readonly turn: number
}

/**
 * Turn-local index of the images a Turn's commands declared as produced files, published as `produced-images` for
 * the chat view: the turn tail shows them, so a reply showing the same image leaves it there. It publishes no view Node.
 */
export const producedImagesDefinition: ConversationNodeDefinition<ProducedImagesState> = {
  kind: 'produced-images',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/result' && isAppendSurfaceEvent(event)) return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('produced-images start requires turn/start')
    return { turn: match.event.data.turn, attachmentIds: new Set(), paths: new Set() }
  },
  update: (context, match) => {
    if (match.event.type !== 'tool/result') return context.state
    const result = match.event.data.message.content[0]
    const meta = match.event.data.meta
    if (result.isError === true || !isRecord(meta) || !Array.isArray(meta.producedFiles)) return context.state
    const stored = storedCopies(result.content)
    const attachmentIds = new Set(context.state.attachmentIds)
    const paths = new Set(context.state.paths)
    for (const file of meta.producedFiles as unknown[]) {
      if (!isRecord(file)) continue
      const path = pathValue(file.path)
      if (path === null || fileKindOf(basename(path)) !== 'image') continue
      const attachmentId = typeof file.attachmentId === 'string' ? file.attachmentId : stored.get(basename(path))
      paths.add(path)
      if (attachmentId !== undefined) attachmentIds.add(attachmentId)
    }
    return paths.size === context.state.paths.size && attachmentIds.size === context.state.attachmentIds.size
      ? context.state
      : { ...context.state, attachmentIds, paths }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    const { turn, attachmentIds, paths } = context.state
    if (previous?.kind === 'turn' && previous.turn === turn && previous.key === 'produced-images'
      && previous.value.attachmentIds === attachmentIds && previous.value.paths === paths) return previous
    return { kind: 'turn', turn, key: 'produced-images', value: { attachmentIds, paths } }
  },
}

/**
 * The folder a path sits in, relative to the workspace root when it lies inside it.
 * @param path - A produced path, absolute or workspace-relative.
 * @param cwd - The session workspace root, when known.
 * @returns The folder below `cwd`, the folder as written otherwise, or `''` at the root.
 */
export function parentFolder(path: string, cwd: string | undefined): string {
  const at = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  const folder = at === -1 ? '' : path.slice(0, at)
  if (cwd === undefined) return folder
  const root = cwd.replace(/[\\/]+$/, '')
  if (folder === root) return ''
  const inside = folder.startsWith(`${root}/`) || folder.startsWith(`${root}\\`)
  return inside ? folder.slice(root.length + 1) : folder
}

/**
 * File-mention vocabulary over one turn's produced paths, for the closing
 * message's prose: an inline-code token opens the file it names. A token
 * resolves by exact path, or by being exactly the basename of exactly one
 * produced path — a basename two paths share stays inert rather than
 * guessing, so a mention link can never open the wrong file or 404.
 * @param files - The turn's produced files (tool order, already deduped).
 * @param openFile - Opens one produced file, from its stored copy where the page cannot open the Host's path.
 * @param label - Localizes the accessible open-label for a resolved path.
 * @param menu - Shows this reader's own menu for a resolved path; omitted where
 * the client has none, which leaves the platform's menu in place.
 * @returns The resolver MarkdownText consumes; the full path rides `title`,
 * the same disambiguator the row's chips carry.
 */
export function producedFileMentions(
  files: readonly ProducedFile[],
  openFile: (file: ProducedFile) => void,
  label: (path: string) => string,
  menu?: (path: string) => void,
): MarkdownFileMentions {
  const paths = files.map(file => file.path)
  return {
    resolve(value) {
      const path = paths.includes(value) ? value : onlyPathWithBasename(paths, value)
      const file = files.find(candidate => candidate.path === path)
      if (path === undefined || file === undefined) return undefined
      return {
        open: () => { openFile(file) },
        label: label(path),
        title: path,
        ...menu === undefined ? {} : { menu: () => { menu(path) } },
      }
    },
  }
}

/** The single produced path whose basename is exactly `value`, else undefined. */
function onlyPathWithBasename(paths: readonly string[], value: string): string | undefined {
  const matches = paths.filter(path => basename(path) === value)
  return matches.length === 1 ? matches[0] : undefined
}
