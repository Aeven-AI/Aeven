/** The registry a content kind joins to become pickable in the right sidebar. */
import { Service, type Context as ClientContext } from '@deepseek-ai/cordis'
import type { ComponentType } from 'react'
import type { SidebarContentKind } from './selection.ts'

/**
 * What a content provider hands the selection: a pane rendered for one
 * session. It receives only the session; a pane translates through its own
 * plugin's dictionary, since the selection's `t` addresses the selection's.
 */
export type SidebarContentComponent = ComponentType<{ readonly sessionId: string }>

/**
 * Registry of the content kinds that have a provider behind them.
 *
 * A kind with no entry still lists in the selection, disabled, so the column
 * states what it will hold. Registration is an effect, so unloading a provider
 * returns its kind to unavailable rather than leaving a dead entry.
 */
export class SidebarContentRegistry extends Service {
  private readonly entries = new Map<SidebarContentKind, SidebarContentComponent>()
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
   * The provider for a kind, when one has registered.
   * @param kind - the content kind to resolve.
   * @returns its component, or undefined while no provider holds it.
   */
  resolve(kind: SidebarContentKind): SidebarContentComponent | undefined {
    return this.entries.get(kind)
  }

  /** The kinds a provider currently answers. */
  available(): ReadonlySet<SidebarContentKind> {
    return new Set(this.entries.keys())
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
