/**
 * The agent's browser engine: every `preview_*` operation, with ChatGPT's
 * pointer waits and timings, run against a {@link BrowserTarget}. It has no
 * Electron or Node dependencies, so the desktop app (sidebar guests, Chrome over
 * CDP) and the Aeven browser extension run the same engine.
 * @module @aeven/browser-engine
 */

export {
  automate, observePage, watchNavigation,
  type BrowserAutomationInput, type BrowserTarget, type CursorStep, type EngineHost,
} from './engine.ts'
export { ChromeTab, prepareTab, type TabChannel } from './chrome-tab.ts'
export { LOCATOR_PRELUDE, MAX_CONTENT_LENGTH, PAGE_MARKDOWN, YOUTUBE_TRANSCRIPT } from './page-scripts.ts'
