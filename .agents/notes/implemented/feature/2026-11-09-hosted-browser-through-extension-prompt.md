# Agent Note: Hosted Aeven asks for the extension and opens sites in the user's browser

Status: implemented

English | [中文](2026-11-09-hosted-browser-through-extension-prompt.zh.md)

## Problem

Hosted Aeven turns the Host's Chromium off, so the user's own browser, reached through the [Aeven extension](../../../../apps/chrome-extension/README.md), is the only browser a hosted session has. The web page served extension tab commands but answered nothing else: `preview_status` told the model to ask the user to open a browser from the right sidebar, `preview_navigate` ("open linkedin") had nothing to open, and a missing extension reached only the model, as an error, with nothing shown to the user.

## Decision

The web page of [`@aeven/client-ui-sidebar-browser`](../../../../packages/client/ui-sidebar-browser/README.md) answers for the user's browser ([`index.ts`](../../../../packages/client/ui-sidebar-browser/src/client/index.ts) `installPageExtension`).

- **Status.** Without a current extension tab, status answers `{ open: false, openable: true, opensIn: 'user-browser' }`, or `{ open: false, openable: false, unavailable: 'browser-unsupported' }` in a browser that cannot install Chrome Web Store extensions (no Chromium client hints, or a mobile one). [`@aeven/tool-browser`](../../../../packages/web/tool-browser/README.md) turns each into its own `nextStep`.
- **Navigate.** Without a current extension tab, or when the user closed it, a navigation opens a new extension tab at the address and makes it current.
- **Install prompt.** Every request that needs the extension first awaits [`ExtensionPrompt.require`](../../../../packages/client/ui-sidebar-browser/src/client/extension-install.ts). When the extension is missing, Aeven's standard modal links the Chrome Web Store page, and the request waits while the page checks every second and when the user returns to the tab. Chrome 156 exposes `chrome.runtime` to an open `aeven.io` page as soon as the extension is installed, so the request goes on without a reload. **Not now** fails the request with an instruction not to ask again in the turn. The wait ends 5 seconds before the tool's deadline, so the model receives an instruction to end its turn instead of `TOOL_TIMEOUT`; the modal stays open, and an install after that offers **Continue**, which sends a message to the session. An unsupported browser gets a modal naming the supported browsers and the desktop download, and the request fails at once.
- **History.** Every status answer from the page carries `surface: 'user-browser'`. `preview_history` then treats a search as `source: browser`, so the approval names the user's browser, and the page reads that browser's history for any source: the page has no browser beside the chat.
- **Settings.** While the extension is not connected, the web page's extension row offers the store page, and its explanation says that only the desktop app starts the browser.

## Alternatives considered

Checking for the extension when the page loads was rejected: most turns need no browser, and public pages are read with `web_fetch`. An inline chat card was not chosen, because the prompt must exist before the tool call returns and the ask-user card cannot link a store page or detect the install. Failing the call at once and asking the user to try again was rejected, because the page detects the install while it is open. Opening a separate browser window would need a new extension version and another store review; the extension's tabs stay in the user's window, in its Aeven tab group.

## Consequences

The tool's `actionTimeoutMs` bounds how long the user has to install while the call waits; past it, continuing needs the **Continue** button or a reply. The **Continue** message is a user message that the page writes, and the session logs it as one. The first-step browser context still calls the current extension tab "the in-app browser open beside this chat", as it already does on the desktop.

## Verification

In a fresh Chrome 156 profile on `https://aeven.io/`, `chrome.runtime` was undefined before the install, and the extension answered `hello` on the same page right after `Extensions.loadUnpacked`, without a reload. From that page, `tabs.create` opened `https://example.com` in an Aeven tab and `operate` read its status and text. On the hosted profile run locally, with the extension removed, asking to open a site showed the prompt within 3 seconds; installing the extension 3 seconds later closed the prompt within a second, and the same `preview_navigate` call returned the opened tab, after which the agent read the page. Closing the prompt failed the call as declined. With Android client hints and no extension, the call failed at once and the unsupported-browser modal showed. A history search asked to search "the history of your browser, through the Aeven extension" and, once allowed, found the article the agent had opened earlier. `tsc` passes for both packages and `pnpm run build` is green.
