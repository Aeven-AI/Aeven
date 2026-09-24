/** The registry a content kind joins to become pickable in the right sidebar. */
import { Service, type Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType, ReactNode } from 'react'
import type { SidebarContentKind } from './selection.ts'

/** How a pane names its pill while it shows something more specific than its kind. */
export interface SidebarSurfaceTab {
  /** The pill's label, such as the file a Files surface has open. */
  readonly title: string
  /** The pill's glyph; the kind's own glyph when omitted. */
  readonly icon?: ReactNode
}

/** What the column hands each open surface's pane. */
export interface SidebarContentPaneProps {
  /** The session the column belongs to. */
  readonly sessionId: string
  /** The pill this pane renders; stable while the pill stays open. */
  readonly surfaceId: string
  /** Whether this pane's pill is the one shown; hidden panes stay mounted. */
  readonly active: boolean
  /** Rename the pill, or return it to its kind's name with `undefined`. */
  readonly setTab: (tab: SidebarSurfaceTab | undefined) => void
  /** Close this pill when its own flow is dismissed. */
  readonly closeSurface: () => void
}

/**
 * What a content provider hands the column: a pane rendered for one open pill
 * of its kind. A pane translates through its own plugin's dictionary, since
 * the column's `t` addresses the column's.
 */
export type SidebarContentComponent = ComponentType<SidebarContentPaneProps>

/**
 * Called when the user closes one pill of a kind, as opposed to its pane
 * unmounting because the column switched sessions. A kind that owns a
 * resource outliving the pane, such as a shell process, releases it here.
 */
export type SidebarSurfaceCloseHandler = (sessionId: string, surfaceId: string) => void

/**
 * What a kind runs when picked, in place of opening a pill: for content that
 * lives outside the column, such as the Host's own browser window.
 */
export type SidebarContentLauncher = (sessionId: string) => void

/**
 * Registry of the content kinds that have a provider behind them.
 *
 * A kind with no entry still lists in the selection, disabled, so the column
 * states what it will hold. Registration is an effect, so unloading a provider
 * returns its kind to unavailable rather than leaving a dead entry.
 */
export class SidebarContentRegistry extends Service {
  private readonly entries = new Map<SidebarContentKind, SidebarContentComponent>()
  private readonly closeHandlers = new Map<SidebarContentKind, SidebarSurfaceCloseHandler>()
  private readonly launchers = new Map<SidebarContentKind, SidebarContentLauncher>()
  private readonly pendingOpens = new Map<string, SidebarContentKind>()
  private readonly listeners = new Set<() => void>()
  /** Bumped on every add or removal, so a reader can compare snapshots. */
  version = 0

  /**
   * @param ctx - the registering plugin's context.
   */
  constructor(ctx: ClientContext) {
    super(ctx, 'sidebarContent')
  }

  /**
   * Add a provider for one kind.
   * @param kind - the content kind this provider answers.
   * @param component - what the sidebar renders once that kind is chosen.
   * @returns disposer removing the provider.
   */
  register(kind: SidebarContentKind, component: SidebarContentComponent): () => void {
    this.entries.set(kind, component)
    this.emit()
    return () => {
      if (this.entries.get(kind) === component) {
        this.entries.delete(kind)
        this.emit()
      }
    }
  }

  /**
   * Make one kind a launcher: picking it runs `launch` and opens no pill.
   * @param kind - the content kind this launcher answers.
   * @param launch - receives the column's session when the kind is picked.
   * @returns disposer removing the launcher.
   */
  registerLauncher(kind: SidebarContentKind, launch: SidebarContentLauncher): () => void {
    this.launchers.set(kind, launch)
    this.emit()
    return () => {
      if (this.launchers.get(kind) === launch) {
        this.launchers.delete(kind)
        this.emit()
      }
    }
  }

  /**
   * The launcher for a kind, when one has registered.
   * @param kind - the content kind to resolve.
   * @returns its launch action, or undefined while the kind has none.
   */
  launcher(kind: SidebarContentKind): SidebarContentLauncher | undefined {
    return this.launchers.get(kind)
  }

  /** Ask the column to show a kind for a session, including when that session mounts later. */
  requestOpen(sessionId: string, kind: SidebarContentKind): void {
    this.pendingOpens.set(sessionId, kind)
    this.emit()
  }

  /** Consume a pending open after the column has handled it. */
  takeOpenRequest(sessionId: string): SidebarContentKind | undefined {
    const kind = this.pendingOpens.get(sessionId)
    this.pendingOpens.delete(sessionId)
    return kind
  }

  /**
   * Handle the user closing a pill of one kind.
   * @param kind - the content kind whose closes this handles.
   * @param handler - receives the closed pill's session and surface id.
   * @returns disposer removing the handler.
   */
  registerCloseHandler(kind: SidebarContentKind, handler: SidebarSurfaceCloseHandler): () => void {
    this.closeHandlers.set(kind, handler)
    return () => {
      if (this.closeHandlers.get(kind) === handler) this.closeHandlers.delete(kind)
    }
  }

  /**
   * Report closed pills to their kinds' close handlers.
   * @param sessionId - the column's session.
   * @param surfaces - the closed pills.
   */
  closed(sessionId: string, surfaces: readonly { readonly id: string; readonly kind: SidebarContentKind }[]): void {
    for (const surface of surfaces) this.closeHandlers.get(surface.kind)?.(sessionId, surface.id)
  }

  /**
   * The provider for a kind, when one has registered.
   * @param kind - the content kind to resolve.
   * @returns its component, or undefined while no provider holds it.
   */
  resolve(kind: SidebarContentKind): SidebarContentComponent | undefined {
    return this.entries.get(kind)
  }

  /** The kinds a pane or a launcher currently answers. */
  available(): ReadonlySet<SidebarContentKind> {
    return new Set([...this.entries.keys(), ...this.launchers.keys()])
  }

  /**
   * Observe registration changes, so a pane that mounts later is picked up.
   * @param listener - called after every add or removal.
   * @returns disposer removing the listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Right sidebar content kinds and their providers. */
    sidebarContent: SidebarContentRegistry
  }
}
