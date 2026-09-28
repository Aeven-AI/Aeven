/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns the column geometry (fold state machine, brand row, header row, New
 * Session); the header row's leading seat and its trailing action cluster are
 * the `sidebar.header.leading` and `sidebar.header.action` registrants'
 * (ui-workspace), everything between the New Session link and the
 * list bottom is the `sidebar.workspaces` registrant's, and the foot is the
 * `sidebar.settings` registrant's (ui-settings), followed by optional footer
 * actions in `sidebar.footer.action`.
 */
import type { PropsLocale, PropsRenderSlots, PropsRuntime } from '@aeven/client-ui-slots'
import type { WorkspaceId } from '@aeven/api-workspace-controller/client'
import type { SessionId } from '@aeven/session/types'
// Type-only: pulls ui-layout's SlotMap merge (the 'sidebar' entry) into every
// program that sees this contract, so PropsRuntime<'sidebar'> resolves.
import type {} from '@aeven/client-ui-layout/client'

declare module '@aeven/client-ui-slots' {
  interface SlotMap {
    /**
     * Brand mark available to an expanded sidebar presentation.
     * Declared by this package's `sidebar` entry; deployments may replace
     * the shell's fish fallback without replacing the surrounding controls.
     */
    'sidebar.brand.mark': { kind: 'single'; scope: 'root'; owner: SidebarBrandMarkOwnerProps }
    /**
     * Brand name rendered beside the expanded mark. Declared by this
     * package's `sidebar` entry; the shell supplies a generic text fallback.
     */
    'sidebar.brand.name': { kind: 'single'; scope: 'root'; owner: SidebarBrandNameOwnerProps }
    /**
     * The header row's leading seat: the browsing region's search control.
     * Declared by this package's 'sidebar' entry; ui-workspace registers the
     * field here, so the panel's own leading edge holds the control that opens
     * the region's search. The seat takes the room the row's trailing cluster
     * leaves, which is what lets an expanded field grow across the header.
     */
    'sidebar.header.leading': { kind: 'single'; scope: 'root'; owner: SidebarHeaderLeadingOwnerProps }
    /**
     * The action cluster at the header row's trailing edge: the browsing
     * region's view-options and add-workspace controls. Declared by this
     * package's 'sidebar' entry; ui-workspace registers the cluster. Each
     * occupant owns its own buttons, labels, and spacing, and the shell clips
     * the cluster as the column collapses.
     */
    'sidebar.header.action': { kind: 'list'; scope: 'root'; owner: SidebarHeaderActionOwnerProps }
    /**
     * The workspace/session browsing region: the grouped/flat session list or
     * the search results, plus every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

/** Geometry supplied to the sidebar brand-mark occupant. */
export interface SidebarBrandMarkOwnerProps {
  /** Requested square edge in pixels. */
  size: number
}

/** Empty owner share for the sidebar brand-name occupant. */
export interface SidebarBrandNameOwnerProps {
  /** Marker field: the occupant owns its own content and width. */
  children?: never
}

/**
 * Empty owner share for the header's leading seat: the occupant owns its own
 * control, labels, and width, and reads whatever else it needs through its own
 * registration.
 */
export interface SidebarHeaderLeadingOwnerProps {
  /** Marker field: the occupant owns its own control and width. */
  children?: never
}

/**
 * Empty owner share for the header action cluster: the occupant owns its own
 * controls, labels, and geometry, and reads whatever else it needs through its
 * own registration.
 */
export interface SidebarHeaderActionOwnerProps {
  /** Marker field: the occupant owns its own controls and width. */
  children?: never
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser. */
  wide: boolean
  /** Compact controls request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row must render against.
 */
export interface SidebarSettingsOwnerProps {
  /** Whether the sidebar renders its expanded content. */
  wide: boolean
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders its expanded content. */
  wide: boolean
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The shell keeps only its own controls: starting a Session from
 * the New Session link and toggling the column.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session and open it.
   *
   * With a `sessionId`, the Session is created under exactly that id — the one
   * the New Session link published, so the address that was opened and the chat
   * that appears are the same. Without one, the Workspace's existing blank
   * Session is reused when it has one. Either way, the Workspace is the
   * explicit target, else the current Session's, else the most recent; with
   * none at all, the selection clears into the New Session pure view.
   * @param workspaceId - explicit target; absent inherits as described.
   * @param sessionId - the id the New Session link named, when it had one.
   */
  startSession: (workspaceId?: WorkspaceId, sessionId?: SessionId) => void
  /**
   * Address for the New Session link, plus the id it names. The browser owns
   * activation of a real anchor, so this answers before any Session exists;
   * the id comes back to {@link startSession} when the link is activated here.
   */
  newSessionHref: () => { href: string; sessionId: SessionId }
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
}

/**
 * Full component props: layout owner state/actions plus the declared holes'
 * render shares, this package's injected callbacks, and the standard locale
 * seat. No store is registered.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    | 'sidebar.brand.mark'
    | 'sidebar.brand.name'
    | 'sidebar.header.leading'
    | 'sidebar.header.action'
    | 'sidebar.workspaces'
    | 'sidebar.settings'
    | 'sidebar.footer.action'
  >
  & SidebarRootInjected & PropsLocale<'sidebar'>
