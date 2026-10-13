/**
 * LayoutController: the cross-plugin panel-action face behind ctx.layout.
 * Panel geometry itself lives in the root entry's layout store (stores.ts);
 * the current-session selection lives with the runtime sessions service, and
 * the per-session active view dissolved into ui-conversation's session store
 * (its only consumer). What remains here is the contract other plugins'
 * apply worlds reach for panel transitions (sidebar toggle from ui-sidebar,
 * details open/close from ui-conversation) — writes stay inside the store's
 * declared action set, delivered as the registration's bound actions.
 */
import type { BoundActions } from '@aeven/client-ui-slots'
import type { createLayoutStore } from './stores.ts'
import type { ISurfaces } from './surfaces.ts'

/** The layout store's bound action set (framework-baked, draft params peeled). */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/**
 * The outward layout face (`ctx.layout`): the panel transitions other
 * plugins may trigger — and exactly what a test fake must supply. The
 * attachPanels wiring hook stays on the concrete class (root-entry assembly
 * only).
 */
export interface ILayout {
  /** Surface routing: which full-page surface owns the center column. */
  readonly surfaces: ISurfaces
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel (no-op when already open). */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
  /**
   * Report that a surface has taken over the viewport, so the shell's chrome
   * yields its stacking order for as long as it is up.
   * @param fullscreen - whether a full-screen surface is now showing.
   */
  setFullscreen(fullscreen: boolean): void
  /**
   * Toggle one session's right sidebar. The panel is per session, so this
   * leaves every other session's where its reader left it.
   * @param sessionId - session whose panel toggles.
   */
  toggleRightbar(sessionId: string): void
  /** Show one session's right sidebar without closing an already open panel. */
  openRightbar(sessionId: string): void
}

/** Cross-plugin panel-action face (ctx.layout). */
export class LayoutController implements ILayout {
  #panels: PanelActions | undefined

  /** @param surfaces - the surface router this face publishes. */
  constructor(readonly surfaces: ISurfaces) {}

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render; on entry re-register the
   * fresh actions overwrite the stale set.
   * @param actions - bound actions of the entry's layout store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /**
   * Report that a surface has taken over the viewport.
   * @param fullscreen - whether a full-screen surface is now showing.
   */
  setFullscreen(fullscreen: boolean): void {
    this.#require().setFullscreen(fullscreen)
  }

  /**
   * Toggle one session's right sidebar.
   * @param sessionId - session whose panel toggles.
   */
  toggleRightbar(sessionId: string): void {
    // The frame width seeds a first opening and re-clamps a remembered one.
    // Read here rather than tracked: only an opening needs it, so the frame
    // carries no measurement loop and a drag stays a CSS-only write. The
    // store clamps to its floor, so a DOM-less caller still opens a usable
    // panel.
    const viewport = typeof window === 'undefined' ? 0 : window.innerWidth
    this.#require().toggleRightbar(sessionId, viewport)
  }

  /** Show one session's right sidebar. */
  openRightbar(sessionId: string): void {
    const viewport = typeof window === 'undefined' ? 0 : window.innerWidth
    this.#require().openRightbar(sessionId, viewport)
  }

  #require(): PanelActions {
    // Callers are UI gestures, which cannot fire before the root entry
    // rendered (the inject hook runs in its first render) — reaching this
    // unwired is a boot-order bug, not a race to tolerate.
    if (this.#panels === undefined) throw new Error('layout: panel actions not wired (root entry not mounted)')
    return this.#panels
  }
}
