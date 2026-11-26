/**
 * What one Files surface remembers between mounts: the folders it has open, the
 * file it shows, whether its tree is docked beside that file and how wide, its
 * search, whether it lists ignored names, and whether an HTML file shows
 * rendered or as source.
 *
 * Kept in memory per session and surface, so switching sessions or pills and
 * back finds the explorer where it was; a reload starts it at the root. The
 * HTML view is the reader's own preference: a surface starts with the view
 * chosen last on this browser, rendered when none was chosen.
 */

/** One Files surface's navigation state. */
export interface ExplorerMemory {
  /** Workspace-relative paths of the open folders. */
  readonly expanded: ReadonlySet<string>
  /** Workspace-relative path of the file on show, or null for the tree alone. */
  readonly openFile: string | null
  /** Whether the tree stays docked beside an open file. */
  readonly treeVisible: boolean
  /** The docked tree's dragged width in px, or null for the default width. */
  readonly dockWidth: number | null
  /** The search field's text. */
  readonly query: string
  /** Whether the tree also lists the names the deployment ignores by default, such as `.git` and `node_modules`. */
  readonly showIgnored: boolean
  /** How an HTML file opens: rendered in a sandboxed frame, or as its source. */
  readonly htmlView: 'preview' | 'source'
}

/** A surface the explorer has not shown before, before the saved HTML view is applied. */
export const FRESH_MEMORY: ExplorerMemory = {
  expanded: new Set(), openFile: null, treeVisible: false, dockWidth: null, query: '', showIgnored: false,
  htmlView: 'preview',
}

/** Browser storage key of the HTML view the reader chose last. */
const HTML_VIEW_KEY = 'avn.sidebarFiles.htmlView'

/**
 * The HTML view the reader chose last on this browser.
 * @returns the saved view, or `preview` when none was saved.
 */
export function savedHtmlView(): ExplorerMemory['htmlView'] {
  try {
    return localStorage.getItem(HTML_VIEW_KEY) === 'source' ? 'source' : 'preview'
  } catch {
    // Storage unavailable: files open rendered, the default.
    return 'preview'
  }
}

/**
 * Save the HTML view the reader chose, so every surface opened after it starts there.
 * @param view - the chosen view.
 */
export function saveHtmlView(view: ExplorerMemory['htmlView']): void {
  try {
    localStorage.setItem(HTML_VIEW_KEY, view)
  } catch {
    // Same unavailable storage as savedHtmlView: the choice holds for this surface only.
  }
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
  return {
    ...memory,
    expanded: new Set([...memory.expanded].filter(entry => !gone(entry))),
    openFile: memory.openFile !== null && gone(memory.openFile) ? null : memory.openFile,
  }
}

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
  return memories.get(keyOf(sessionId, surfaceId)) ?? { ...FRESH_MEMORY, htmlView: savedHtmlView() }
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
