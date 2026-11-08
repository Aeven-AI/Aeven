/** Browser preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'
import { DEFAULT_SEARCH_ENGINE, SEARCH_ENGINE_IDS, type SearchEngineId } from './search-engines.ts'

/** Settings namespace owned by the browser plugin. */
export const BROWSER_SETTINGS_NAMESPACE = 'ui-browser'

/** Field carrying the engine an address-bar entry that names no address searches with. */
export const SEARCH_ENGINE_FIELD = 'searchEngine'

/** Field carrying whether the agent may use the reader's own Chrome. */
export const USER_CHROME_FIELD = 'userChrome'

/** Durable browser section shared by the Host schema and the browser scope. */
export interface BrowserSettings {
  /** Engine the address bar searches with. */
  searchEngine: SearchEngineId
  /** Whether the agent may list and drive the reader's everyday Chrome; off by default. */
  userChrome: boolean
}

/** Durable browser schema; also the wire envelope the browser scope validates against. */
export const BrowserSettingsSchema: z<BrowserSettings> = z.object({
  [SEARCH_ENGINE_FIELD]: z.union([...SEARCH_ENGINE_IDS]).default(DEFAULT_SEARCH_ENGINE),
  [USER_CHROME_FIELD]: z.boolean().default(false),
})
