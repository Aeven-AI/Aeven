/** Client-safe Remote wire types of the Host's Chromium. @module @aeven/browser-chromium/types */

/** What opening the browser reports. */
export interface BrowserChromiumOpened {
  /** The debugging endpoint chrome-devtools-mcp attaches to. */
  readonly browserUrl: string
}
