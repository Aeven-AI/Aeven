/**
 * The reader's search engine: a mirror of the Host user-settings section plus
 * the endpoints that section resolves to. The pane reads the engine through
 * the mirror, so a change made on the Settings page reaches an open pane.
 */
import { createSnapshotStore, type SnapshotStore } from '@aeven/client-store'
import type { SettingsScope } from '@aeven/client-ui-settings/client'
import { SEARCH_ENGINE_FIELD, type BrowserSettings } from '../browser-settings.ts'
import { DEFAULT_SEARCH_ENGINE, searchUrl, suggestUrl, type SearchEngineId } from '../search-engines.ts'

/** Live search-engine choice for one browser plugin instance. */
export class SearchEnginePreference {
  /** Reactive current engine; the default until the Host section arrives. */
  readonly engine: SnapshotStore<SearchEngineId> = createSnapshotStore(DEFAULT_SEARCH_ENGINE)

  private host: SettingsScope<BrowserSettings> | undefined

  /**
   * Follow one Host settings section.
   * @param host - the durable browser section.
   * @returns disposer that stops following it.
   */
  attach(host: SettingsScope<BrowserSettings>): () => void {
    this.host = host
    const off = host.subscribe(() => { this.adopt() })
    this.adopt()
    return () => {
      off()
      this.host = undefined
    }
  }

  /**
   * Publish and persist one explicit user choice.
   * @param engine - engine the reader picked.
   */
  setEngine(engine: SearchEngineId): void {
    if (this.engine.getSnapshot() === engine) return
    this.engine.set(engine)
    void this.host?.set(SEARCH_ENGINE_FIELD, engine)
  }

  /**
   * The results page an address-bar query opens.
   * @param query - text the reader typed.
   * @returns the absolute address to load.
   */
  search(query: string): string {
    return searchUrl(this.engine.getSnapshot(), query)
  }

  /**
   * The completion endpoint for the engine in force.
   * @param query - text the reader has typed so far.
   * @returns the absolute address answering with completions.
   */
  suggest(query: string): string {
    return suggestUrl(this.engine.getSnapshot(), query)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host?.getSnapshot().value
    if (section === undefined || this.engine.getSnapshot() === section.searchEngine) return
    this.engine.set(section.searchEngine)
  }
}
