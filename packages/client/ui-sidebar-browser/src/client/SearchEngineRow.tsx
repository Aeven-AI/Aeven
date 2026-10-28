/**
 * General Settings row choosing the search engine. An address-bar entry that
 * names no host is searched for with this engine, so the row is the reader's
 * one control over where the sidebar browser enters the web.
 */
import type { SnapshotStore } from '@aeven/client-store'
import { SettingsRow, SettingsSelect } from '@aeven/client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-settings/client'
import { isSearchEngineId, SEARCH_ENGINE_IDS, type SearchEngineId } from '../search-engines.ts'
import { ENGINE_NAME_KEYS } from './locales.ts'

/** Registration-side search-engine face. */
export interface SearchEngineRowInjected {
  hooks: {
    /** Persisted engine, bound as useSearchEngine. */
    searchEngine: SnapshotStore<SearchEngineId>
  }
  /** Store one engine choice in the Host settings document. */
  setSearchEngine: (engine: SearchEngineId) => void
}

/** Full Settings-row props. */
export type SearchEngineRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'sidebarBrowser'>
  & InjectFace<SearchEngineRowInjected>

/**
 * Render the search-engine selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function SearchEngineRow({ useSearchEngine, setSearchEngine, t }: SearchEngineRowProps) {
  const engine = useSearchEngine(value => value)

  return (
    <SettingsRow
      title={t('browser.engine')}
      description={t('browser.engine.description')}
      control={(
        <SettingsSelect
          items={SEARCH_ENGINE_IDS.map(id => ({ id, label: t(ENGINE_NAME_KEYS[id]) }))}
          selectedId={engine}
          onSelect={(id) => { if (isSearchEngineId(id)) setSearchEngine(id) }}
        />
      )}
    />
  )
}
