/**
 * The root entry's layout store: panel geometry as plain widths in px
 * (0 = closed). The sidebar width, the right sidebar's width, and which
 * sessions have that panel open are the durable fields — a column the user
 * closed or dragged stays that way across a reload — while details and the
 * narrow pair start fresh each page (details defaults closed, and the narrow
 * pair is a reading of the current viewport). Module level exports the
 * factory only — a module-level handle would pin the store's identity in the
 * module cache (a de-facto singleton surviving plugin reloads). register()
 * receives the factory (exclusive use: the framework instantiates per entry),
 * AppFrame derives its PropsStore share from the return type, and the service
 * face receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@aeven/client-store'
import {
  clampRightbar, clampWidth, defaultRightbar, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/** One session's right sidebar state. */
export type RightbarSurface = {
  /** Whether the panel is drawn for this session. */
  shown: boolean
}

/**
 * Layout store state: panel width preferences in px (0 = closed), plus the
 * narrow-viewport pair — `narrow` mirrors AppFrame's breakpoint reading
 * (viewport < SIDEBAR_AUTO_COLLAPSE) so toggleSidebar can pick semantics, and
 * `narrowExpanded` is the manual override that re-expands the auto-collapsed
 * sidebar over the squeezed center without rewriting the width preference.
 */
type LayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
  /**
   * Whether the right sidebar is drawn, per session id. Switching sessions
   * leaves each panel open or closed as its reader left it, so being open is
   * a property of the session being read. Persisted, so a reload restores
   * that; a session absent from the map opens closed.
   *
   * The width is not here — it is one preference for every session
   * ({@link LayoutState.rightbarWidth}).
   *
   * Frame width is not kept here either. It is read in CSS from one custom
   * property on the frame, which is what keeps a drag off the transcript's
   * style invalidation path (AppFrame.module.css).
   */
  rightbar: Record<string, RightbarSurface>
  /**
   * The right sidebar's width in px, shared by every session; 0 before the
   * panel has first opened anywhere. Dragging the panel sets how wide this
   * reader wants it, which is a preference about the window rather than about
   * the session being read: a width dragged in one session is the width every
   * other session's panel opens at. Which sessions are open stays per session,
   * above.
   *
   * 0 rather than null for the unset state: persistence adopts a stored field
   * only when it carries the same `typeof` as the initial value, so a null
   * seed would drop every restored width on the floor.
   */
  rightbarWidth: number
  /**
   * A surface has taken over the viewport — a transcript block opened full
   * screen, today. The shell's own chrome yields its stacking order while
   * this is set, so the surface is not painted over by the sidebar, the
   * session header or the composer.
   */
  fullscreen: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
  setFullscreen: (draft: LayoutState, fullscreen: boolean) => void
  setRightbar: (draft: LayoutState, px: number, viewport: number) => void
  toggleRightbar: (draft: LayoutState, sessionId: string, viewport: number) => void
  openRightbar: (draft: LayoutState, sessionId: string, viewport: number) => void
}

/** localStorage key holding this store's durable fields. */
const LAYOUT_STORE_KEY = 'avn.layout.panels'

/**
 * Show one session's right sidebar, seeding the shared width on the first
 * opening anywhere. Shared by the open and toggle actions rather than one
 * calling the other: actions are pure draft mutators, not a callable set.
 * @param draft - layout draft being mutated.
 * @param sessionId - session whose surface opens.
 * @param viewport - current frame width in px.
 */
function showRightbar(draft: LayoutState, sessionId: string, viewport: number): void {
  draft.rightbar[sessionId] = { shown: true }
  // A width remembered from a wider frame is re-clamped on reopening, so the
  // panel cannot come back wider than the current frame allows.
  draft.rightbarWidth = draft.rightbarWidth === 0
    ? defaultRightbar(viewport)
    : clampRightbar(draft.rightbarWidth, viewport)
}

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 *
 * The right sidebar splits the two: being open is per session, while the width
 * is one preference for every session, because how wide the reader wants the
 * panel is a fact about the window rather than about what is being read. Both
 * persist, so a reload restores each session's panel at the shared width.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false, fullscreen: false,
      rightbar: {}, rightbarWidth: 0,
    }),
    // Reload restores the columns the reader left: the sidebar's width,
    // including a closed one (0), and each session's right sidebar. Details
    // stays out — its archived default is closed, and it reopens from an
    // explicit selection, not from the last page's geometry.
    persist: { key: LAYOUT_STORE_KEY, fields: ['sidebar', 'rightbar', 'rightbarWidth'] },
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      // Narrow toggles flip only the override: the width preference survives
      // untouched, so re-widening restores the pre-squeeze layout.
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: the
      // narrow default is auto-collapsed, the wide state is the preference.
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
      // Not persisted: a reload has no full-screen surface to restore, and a
      // stored `true` would leave the chrome yielded with nothing over it.
      setFullscreen: (d, fullscreen: boolean) => { d.fullscreen = fullscreen },
      // A drag writes the shared width and names no session: how wide the
      // reader wants the panel is a preference about the window, so a width
      // dragged in one session is the width every other session opens at. It
      // does not touch `shown` either — the handle only exists while the panel
      // is open, and a gesture must not close the panel it is resizing.
      setRightbar: (d, px: number, viewport: number) => {
        d.rightbarWidth = clampRightbar(px, viewport)
      },
      toggleRightbar: (d, sessionId: string, viewport: number) => {
        if (d.rightbar[sessionId]?.shown === true) d.rightbar[sessionId] = { shown: false }
        else showRightbar(d, sessionId, viewport)
      },
      openRightbar: (d, sessionId: string, viewport: number) => {
        if (d.rightbar[sessionId]?.shown !== true) showRightbar(d, sessionId, viewport)
      },
    },
  })
  return handle
}
