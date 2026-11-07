# Agent Note: Sidebar browser commands and pointer timing at ChatGPT parity

Status: implemented

## Problem

The sidebar browser's agent had fourteen `preview_*` tools: no hover, drag, select, check, or read; no JavaScript dialogs, iframes, console, or content export; and no way to press the pane's own toolbar or hand a step to the user. Its pointer was a port of ChatGPT's browser-agent cursor whose solver and frame timing differed from the original, and its actions did not wait the way ChatGPT's do: a click returned before the navigation it started, and a scroll ran a script instead of input.

## Decision

The tools follow the command set and timing of ChatGPT's Chrome extension (version 1.26.1102.11740), reimplemented, not copied.

- **Engine.** Desktop [`browser-automation.ts`](../../../../apps/desktop/src/browser-automation.ts) adds hover, drag, select, check, read, content (markdown, text, html, YouTube captions), Google Docs export, clipboard, console, and dialog operations. Every selector accepts Playwright-style locators ([`browser-page-scripts.ts`](../../../../apps/desktop/src/browser-page-scripts.ts)), strict about multiple matches, and a `frame` argument evaluates in an isolated world of that iframe.
- **Timing.** A pointer action waits up to 1500 ms for the drawn cursor, then moves the mouse and presses; a click watches 250 ms for a navigation and waits up to 3000 ms for its load; back, forward, and reload wait up to 10 s; a drag waits for the cursor only at its first point. These are ChatGPT's values.
- **Scroll.** One wheel event after the cursor arrives. An Electron guest acknowledges `Input.synthesizeScrollGesture`, ChatGPT's default, without scrolling; the wheel is ChatGPT's other scroll method.
- **Dialogs.** An action that opens a dialog returns with it instead of blocking. After `Page.handleJavaScriptDialog`, the engine emits Electron's `-cancel-dialogs` on the guest, because Electron's own message box otherwise stays on screen.
- **Pane controls.** `preview_browser_control` presses the toolbar and the three-dot menu with the pointer, through the pane's `pressControl`, which waits for a portaled menu row to be placed before aiming at it. Clearing cookies or cache, and reading the clipboard, ask for approval.
- **Tabs.** Each Browser pill in the sidebar is a tab with its own guest; the session's current tab is the one last shown, and agent actions address it (`LiveGuests` in [`guest.ts`](../../../../packages/client/ui-sidebar-browser/src/client/guest.ts)). `preview_tabs` presses the pill, the plus menu's Browser row, or the pill's close button with the pointer, whose layer spans the whole sidebar column. Pills keep the Browser label.
- **History.** Committed pages are kept in the window's storage ([`history.ts`](../../../../packages/client/ui-sidebar-browser/src/client/history.ts)), lead the address bar's existing suggestions, and are searchable through `preview_history` after approval. No UI was added.
- **WebMCP.** The desktop shell enables Chromium's `WebMCP` feature; `preview_page_tools` lists `document.modelContext.getTools()` and runs `executeTool`, as ChatGPT's extension does, after approval per site and tool.
- **Handoff.** `preview_handoff` shows Aeven's standard modal over the window (the sidebar can cover the conversation), with OK and Not now, and tells the model to end its turn.
- **Cursor.** The overlay's spring solver restarts one 60 Hz frame behind after a stall and keeps residual velocity when it snaps; frames advance at least 1/60 s and the first frame of a long move exactly that; a hidden pointer reappears at its target; the glow is `#339cff`. These are the reference's values.

## Alternatives considered

Copying the extension's code was rejected: it is proprietary. A ChatGPT-style single scripting tool over the same commands was offered and not chosen; the discrete `preview_*` tools stay. A handoff card docked inside the pane was rejected for the standard modal.

## Consequences

Electron answers `prompt()` with null, so only alert, confirm, and beforeunload reach `preview_dialog`. There are no bookmarks, and the user's Chrome history is not read. The Electron `-cancel-dialogs` event is internal to Electron and is re-checked on Electron upgrades.

## Verification

Typecheck and `pnpm run build` pass; no specs were run. In `dev:desktop`, through the shell bridge and real agent turns: locators, check, select, hover, iframe read, markdown content, slider drag, console, waits, scroll (900 px then −400 px landed at 900 and 500), alert and confirm answered without a lingering sheet, zoom and appearance through the pointer, the handoff modal, tabs opened, switched, and closed by the pointer, and a page's WebMCP tool listed and invoked.
