/**
 * The root entry's layout store: panel geometry as plain widths in px
 * (0 = closed). The sidebar width is the one durable field — a column the
 * user closed or dragged stays that way across a reload — while details and
 * the narrow pair start fresh each page (details defaults closed, and the
 * narrow pair is a reading of the current viewport). Module level exports the
 * factory only — a module-level handle would pin the store's identity in the
 * module cache (a de-facto singleton surviving plugin reloads). register()
 * receives the factory (exclusive use: the framework instantiates per entry),
 * AppFrame derives its PropsStore share from the return type, and the service
 * face receives the bound actions through the registration's inject hook.
 */
import { defineStore, type EngineStoreHandle } from '@aeven/client-store'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

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
}

/** localStorage key holding this store's durable fields. */
const LAYOUT_STORE_KEY = 'dsh.layout.panels'

/**
 * Create the layout panel store handle. The preference IS the width, so
 * closing a panel forgets its drag width — reopening restores the contract
 * default. Actions are the complete write set: drag writes clamp
 * into the panel's contract range and never cross the open/closed line;
 * open/close transitions write 0 / the default explicitly. Below the
 * auto-collapse breakpoint (AppFrame feeds setNarrow) the sidebar toggle
 * flips the narrowExpanded override instead of the preference.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions>  {
  const handle = defineStore({
    init: (): LayoutState => ({
      sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false, fullscreen: false,
    }),
    // Reload restores the sidebar column the user left, including a closed
    // one (0). Details stays out: its archived default is closed, and it
    // reopens from an explicit selection, not from the last page's geometry.
    persist: { key: LAYOUT_STORE_KEY, fields: ['sidebar'] },
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
    },
  })
  return handle
}
