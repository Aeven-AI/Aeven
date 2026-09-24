/**
 * What one Files surface remembers between mounts: the folders it has open, the
 * file it shows, whether its tree is docked beside that file, and its search.
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
}

/** A surface the explorer has not shown before. */
export const FRESH_MEMORY: ExplorerMemory = { expanded: new Set(), openFile: null, treeVisible: false, query: '' }

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
