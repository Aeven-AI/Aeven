# Agent Note: Browser requests for chats the desktop window does not show, and one prompt for a missing extension

Status: implemented

English | [中文](2026-11-19-browser-for-chats-the-desktop-window-does-not-show.zh.md)

## Problem

On 2026-11-19, the owner asked Aeven Web to "open linkedin.com" in a chat that ran on their desktop (session `08b945fd`). Approvals and questions reach Aeven Web through the interaction relay, but `browser/automation` is not relayed, so only the desktop window received the request. That window answered status with `{ open: false, openable: true }` for every session, including ones it did not show, so the model called `preview_navigate`, and `navigateClosed` waited for a pane that could never mount in that window until the call hit `TOOL_TIMEOUT` after 60 s. The model reached the extension only after the owner said "use the extension".

Separately, a web page without the extension showed two different modals: the agent's request showed the extension install modal, which offered no desktop app, and the sidebar's Browser launcher on hosted Aeven showed the desktop hand-off modal, which offered no extension.

## Decision

- **Desktop window.** In [`index.ts`](../../../../packages/client/ui-sidebar-browser/src/client/index.ts), the pane answers status and navigation only for the session the window shows. For any other session, status answers `opensIn: 'user-browser'` and a navigation opens a new tab of the reader's browser through the extension over the desktop bridge.
- **One prompt.** The extension install modal also offers **Open in Æven Desktop**, which follows `aeven://c/<session>`, and **Download Æven Desktop**. When the page loses focus within 1.5 s of following the link, [`ExtensionPrompt.openedDesktop`](../../../../packages/client/ui-sidebar-browser/src/client/extension-install.ts) fails the waiting calls with an instruction to end the turn; otherwise the modal stays and suggests the download. The two primary buttons are the desktop app and the extension. The close button declines, and **Not now** is removed.
- **Launcher.** The web launcher no longer raises `desktop-handoff/request` with reason `browser`; a missing extension shows the install modal, so `@aeven/client-ui-desktop-handoff` is no longer a dependency of the package.

## Alternatives considered

Relaying `browser/automation` to Aeven Web, as approvals are relayed, would let the page in front of the reader answer, but every browser action, including screenshots, would cross the relay. The owner was offered it and it is not built.

## Consequences

The desktop window decides by its current session because the Host does not record which device sent a message. A chat the desktop window happens to show still opens in its pane, and when Aeven Web runs on another computer the extension tab opens in the desktop computer's browser.

## Verification

`tsc` for the package passes and `pnpm run build:client` is green. On the local web client, the install modal rendered the three actions with the desktop and extension buttons primary.
