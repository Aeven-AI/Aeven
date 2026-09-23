/**
 * The right sidebar's open surfaces for one session: an ordered set of pills,
 * each naming a content kind, and the one shown.
 *
 * The set is the whole navigation model; each surface's own state (the browser's
 * page, the explorer's tree) belongs to the pane that renders it. Remembered per
 * session in browser storage, so a reload reopens the pills a session was left
 * with.
 */
import { SIDEBAR_CONTENT_KINDS, readSelection, type SidebarContentKind } from './selection.ts'

/** One open pill. */
export interface SidebarSurface {
  /** Stable identity within the session; keys the pane and its pill. */
  readonly id: string
  /** The content kind whose provider renders it. */
  readonly kind: SidebarContentKind
}

/** A session's open pills and the one shown. */
export interface SurfaceState {
  readonly surfaces: readonly SidebarSurface[]
  /** The shown surface's id, or null while none is open. */
  readonly active: string | null
}

/** A column with no pills open. */
export const EMPTY_SURFACES: SurfaceState = { surfaces: [], active: null }

/** Key prefix for the saved set; one record per session. */
const STORAGE_PREFIX = 'avn.sidebar-right.surfaces'

function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}.${sessionId}`
}

function isContentKind(value: unknown): value is SidebarContentKind {
  return typeof value === 'string' && (SIDEBAR_CONTENT_KINDS as readonly string[]).includes(value)
}

/**
 * A new surface id for `kind`, unique within `state`.
 * @param state - the set the surface joins.
 * @param kind - the surface's content kind.
 * @returns an id not yet in the set.
 */
function nextId(state: SurfaceState, kind: SidebarContentKind): string {
  let index = 1
  while (state.surfaces.some(surface => surface.id === `${kind}:${String(index)}`)) index += 1
  return `${kind}:${String(index)}`
}

/**
 * Read the pills a session was left with.
 *
 * A record this build cannot read is discarded rather than honoured; a session
 * saved by the single-choice selection opens with that one kind as its pill.
 * @param sessionId - session whose set is read.
 * @returns the saved set, or an empty one.
 */
export function readSurfaces(sessionId: string): SurfaceState {
  try {
    const saved = localStorage.getItem(storageKey(sessionId))
    if (saved === null) {
      const legacy = readSelection(sessionId)
      return legacy === undefined ? EMPTY_SURFACES : openSurface(EMPTY_SURFACES, legacy).state
    }
    const parsed = JSON.parse(saved) as { surfaces?: unknown; active?: unknown }
    const surfaces = Array.isArray(parsed.surfaces)
      ? parsed.surfaces.filter((entry): entry is SidebarSurface =>
        typeof entry === 'object' && entry !== null
        && typeof (entry as { id?: unknown }).id === 'string'
        && isContentKind((entry as { kind?: unknown }).kind))
      : []
    const active = typeof parsed.active === 'string' && surfaces.some(surface => surface.id === parsed.active)
      ? parsed.active
      : surfaces.at(-1)?.id ?? null
    return { surfaces, active }
  } catch {
    // Storage unavailable or the record unparsable: the set is a convenience,
    // so the column opens empty rather than failing.
    return EMPTY_SURFACES
  }
}

/**
 * Remember a session's pills.
 * @param sessionId - session whose set is written.
 * @param state - the set to keep.
 */
export function writeSurfaces(sessionId: string, state: SurfaceState): void {
  try {
    if (state.surfaces.length === 0) localStorage.removeItem(storageKey(sessionId))
    else localStorage.setItem(storageKey(sessionId), JSON.stringify(state))
  } catch {
    // Same unavailable storage as readSurfaces: the set holds for this mount.
  }
}

/**
 * Open a new pill of `kind` after the active one and show it.
 * @param state - the current set.
 * @param kind - the kind to open.
 * @returns the new set and the opened surface's id.
 */
export function openSurface(state: SurfaceState, kind: SidebarContentKind): { state: SurfaceState; id: string } {
  const id = nextId(state, kind)
  const at = state.active === null ? state.surfaces.length : state.surfaces.findIndex(s => s.id === state.active) + 1
  const surfaces = [...state.surfaces.slice(0, at), { id, kind }, ...state.surfaces.slice(at)]
  return { state: { surfaces, active: id }, id }
}

/**
 * Close some pills; when the shown one closes, its right neighbour (or else its
 * left) is shown instead, as tab strips do.
 * @param state - the current set.
 * @param close - the ids to close.
 * @returns the remaining set.
 */
export function closeSurfaces(state: SurfaceState, close: ReadonlySet<string>): SurfaceState {
  const surfaces = state.surfaces.filter(surface => !close.has(surface.id))
  if (state.active === null || !close.has(state.active)) return { surfaces, active: state.active }
  const index = state.surfaces.findIndex(surface => surface.id === state.active)
  const after = state.surfaces.slice(index + 1).find(surface => !close.has(surface.id))
  const before = state.surfaces.slice(0, index).reverse().find(surface => !close.has(surface.id))
  return { surfaces, active: (after ?? before)?.id ?? null }
}
