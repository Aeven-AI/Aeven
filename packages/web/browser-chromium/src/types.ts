/** Client-safe types of the Host's Chromium: what opening reports and what status reports. @module @aeven/browser-chromium/types */

/** What opening the browser reports. */
export interface BrowserChromiumOpened {
  /** The debugging endpoint chrome-devtools-mcp attaches to. */
  readonly browserUrl: string
}

/**
 * What the Host's Chromium is, sampled without launching it. Consumers report
 * these facts where a model or a Client decides which browser to drive.
 */
export interface BrowserChromiumStatus {
  /** The debugging endpoint a driving MCP server attaches to. */
  readonly browserUrl: string
  /** Whether a browser answered on that endpoint when sampled. */
  readonly running: boolean
  /** Whether an executable was found, so a launch can succeed. */
  readonly launchable: boolean
  /** Prefix of the tool names that drive this browser; absent when config names no MCP server. */
  readonly toolPrefix?: string
}
