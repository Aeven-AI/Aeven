/** The right sidebar's per-session content choice and where it is remembered. */

/** A content kind the right sidebar can hold. */
export type SidebarContentKind = 'browser' | 'terminal' | 'files' | 'device'

/** The kinds, in the order the selection lists them. */
export const SIDEBAR_CONTENT_KINDS: readonly SidebarContentKind[] = ['browser', 'terminal', 'files', 'device']

/**
 * Kinds with an implementation behind them.
 *
 * A kind outside this set still lists, so the column states what it will hold,
 * but picking it is refused rather than opening an empty panel. Each provider
 * adds its own kind here as it lands.
 */
export const AVAILABLE_CONTENT_KINDS: ReadonlySet<SidebarContentKind> = new Set<SidebarContentKind>()

/** Key prefix for the saved choice; one record per session. */
const STORAGE_PREFIX = 'avn.sidebar-right.content'

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}.${sessionId}`
}

function isContentKind(value: string): value is SidebarContentKind {
  return (SIDEBAR_CONTENT_KINDS as readonly string[]).includes(value)
}

/**
 * Read the kind a session was left on.
 *
 * A value this build does not know is discarded rather than honoured, so a
 * record written by a build that had a kind this one lacks returns the column
 * to its selection instead of addressing content that cannot render.
 * @param sessionId - session whose choice is read.
 * @returns the saved kind, or undefined when none is saved or it is unreadable.
 */
export function readSelection(sessionId: string): SidebarContentKind | undefined {
  try {
    const saved = localStorage.getItem(storageKey(sessionId))
    if (saved === null || !isContentKind(saved)) return undefined
    return saved
  } catch {
    // Storage unavailable (private mode, blocked site data). The choice is a
    // convenience, so the column opens on its selection rather than failing.
    return undefined
  }
}

/**
 * Remember a session's choice, or forget it.
 * @param sessionId - session whose choice is written.
 * @param kind - the chosen kind, or undefined to return the column to its selection.
 */
export function writeSelection(sessionId: string, kind: SidebarContentKind | undefined): void {
  try {
    if (kind === undefined) localStorage.removeItem(storageKey(sessionId))
    else localStorage.setItem(storageKey(sessionId), kind)
  } catch {
    // Same unavailable storage as readSelection: the choice holds for this
    // mount and is simply not restored on the next one.
  }
}
