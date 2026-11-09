/**
 * What one Files surface remembers between mounts: the folders it has open, the
 * file it shows and the files shown before it, whether its tree is docked beside
 * that file, its search, whether it lists ignored names, and whether an HTML file
 * shows rendered or as source.
 *
 * Kept in memory per session and surface, so switching sessions or pills and
 * back finds the explorer where it was; a reload starts it at the root.
 */

/** One Files surface's navigation state. */
export interface ExplorerMemory {
  /** Workspace-relative paths of the open folders. */
  readonly expanded: ReadonlySet<string>
  /** Workspace-relative path of the file on show, or null for the tree alone. */
  readonly openFile: string | null
  /** Whether the tree stays docked beside an open file. */
  readonly treeVisible: boolean
  /** The search field's text. */
  readonly query: string
  /** Files opened on this surface, oldest first, which back and forward step through. */
  readonly history: readonly string[]
  /** Index in {@link history} of the file on show, or -1 before any. */
  readonly historyIndex: number
  /** Whether the tree also lists the names the deployment ignores by default, such as `.git` and `node_modules`. */
  readonly showIgnored: boolean
  /** How an HTML file opens: rendered in a sandboxed frame, or as its source. */
  readonly htmlView: 'preview' | 'source'
}

/** A surface the explorer has not shown before. */
export const FRESH_MEMORY: ExplorerMemory = {
  expanded: new Set(), openFile: null, treeVisible: false, query: '', history: [], historyIndex: -1, showIgnored: false,
  htmlView: 'preview',
}

/**
 * Show a file, recording it in the surface's history after the file on show and dropping anything forward of it.
 * @param memory - the surface's state.
 * @param path - workspace-relative path of the file.
 * @returns the state with the file on show.
 */
export function visit(memory: ExplorerMemory, path: string): ExplorerMemory {
  if (memory.history[memory.historyIndex] === path) return { ...memory, openFile: path }
  const history = [...memory.history.slice(0, memory.historyIndex + 1), path].slice(-HISTORY_LIMIT)
  return { ...memory, openFile: path, history, historyIndex: history.length - 1 }
}

/**
 * Step through the surface's history.
 * @param memory - the surface's state.
 * @param step - -1 for back, 1 for forward.
 * @returns the state with the neighbouring file on show, or the same state at either end.
 */
export function stepHistory(memory: ExplorerMemory, step: -1 | 1): ExplorerMemory {
  const index = memory.historyIndex + step
  const path = memory.history[index]
  return path === undefined ? memory : { ...memory, openFile: path, historyIndex: index }
}

/**
 * Follow a rename through everything the surface remembers by path.
 * @param memory - the surface's state.
 * @param from - the entry's old workspace path.
 * @param to - its new workspace path.
 * @returns the state naming the new path wherever it named the old one or a path inside it.
 */
export function renamed(memory: ExplorerMemory, from: string, to: string): ExplorerMemory {
  const move = (path: string): string => path === from ? to : path.startsWith(`${from}/`) ? to + path.slice(from.length) : path
  return {
    ...memory,
    expanded: new Set([...memory.expanded].map(move)),
    openFile: memory.openFile === null ? null : move(memory.openFile),
    history: memory.history.map(move),
  }
}

/**
 * Forget a deleted entry wherever the surface remembers it.
 * @param memory - the surface's state.
 * @param path - the deleted entry's workspace path.
 * @returns the state without the entry, the paths inside it, or a file view of either.
 */
export function forgotten(memory: ExplorerMemory, path: string): ExplorerMemory {
  const gone = (candidate: string): boolean => candidate === path || candidate.startsWith(`${path}/`)
  const history = memory.history.filter(entry => !gone(entry))
  const openFile = memory.openFile !== null && gone(memory.openFile) ? null : memory.openFile
  return {
    ...memory,
    expanded: new Set([...memory.expanded].filter(entry => !gone(entry))),
    openFile,
    history,
    historyIndex: openFile === null ? history.length - 1 : history.lastIndexOf(openFile),
  }
}

/** Files one surface's history keeps. */
const HISTORY_LIMIT = 50

const memories = new Map<string, ExplorerMemory>()

function keyOf(sessionId: string, surfaceId: string): string {
  return `${sessionId}\u0000${surfaceId}`
}

/**
 * The state a surface was left in.
 * @param sessionId - the session the surface belongs to.
 * @param surfaceId - the surface's pill id.
 * @returns its remembered state, or a fresh one.
 */
export function recall(sessionId: string, surfaceId: string): ExplorerMemory {
  return memories.get(keyOf(sessionId, surfaceId)) ?? FRESH_MEMORY
}

/**
 * Remember a surface's state.
 * @param sessionId - the session the surface belongs to.
 * @param surfaceId - the surface's pill id.
 * @param memory - the state to keep.
 */
export function remember(sessionId: string, surfaceId: string, memory: ExplorerMemory): void {
  memories.set(keyOf(sessionId, surfaceId), memory)
}

/**
 * Every ancestor folder of a workspace-relative path, outermost first.
 * @param path - a workspace-relative path.
 * @returns the folders that must be open for the path's row to show.
 */
export function ancestorsOf(path: string): string[] {
  const parts = path.split('/')
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'))
}
