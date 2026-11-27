# Agent Note: Extension tabs show the agent's presence, its step, and when it needs the person

Status: implemented

English | [中文](2026-11-27-extension-agent-indicator.zh.md)

## Problem

In a tab the Aeven browser extension drives, the only sign of the agent was its pointer and Chrome's debugging bar. Nothing showed which tab the agent held, what it was doing there, that a step waited for the person, or that the agent had finished. Claude in Chrome (1.0.109) shows a glow around the page, a status tag, a changed tab icon, and a status mark on its tab group's name. Readers asked for the same in Æven's extension.

## Decision

While the extension controls a tab through the debugger, `apps/chrome-extension/src/indicator-page.ts` draws three things into it:

- a glow around the viewport in the agent pointer's blue (`#339cff`);
- a status tag along the bottom, in white Google Sans Flex at weight 550 on `#0b6fd8`, naming the current step;
- the Æven icon in place of the page's tab icon.

The worker (`background.ts`) draws them at the start of every operation and again after it, because a navigation replaces the document. It removes them before the debugger detaches. They live in a closed shadow root with a constructed stylesheet, and the font is loaded from bytes the worker reads from the extension's own copy. Neither a page's styles nor its style and font Content Security Policy can block them. The page title is never changed, because the browser records titles in its history.

The tab group's name carries the state as a mark, like Claude's ⌛/✅: ⌛Æven while acting, ✋Æven while a step waits for the person, ✅Æven when finished. When the agent stops acting without finishing, the group reverts to plain Æven. The group is renamed from `Aeven` to `Æven`; groups still carrying the old name are found and reused.

The app tells the extension about hand-offs and turn ends through a new `indicate` value of the existing `operate` request, carried by the same `chromeAutomate` path as the agent's actions. `packages/client/ui-sidebar-browser/src/client/extension-attention.ts` records the extension tab each session's agent acted in during the running turn:

- a hand-off sends `input` with the agent's message;
- the turn's end sends `done`, unless a hand-off is still waiting.

The extension shows `input` until the agent acts again, `done` for four seconds, and both as a notification that brings the tab forward when clicked. That adds the `notifications` permission, which shows no install warning. The copy follows the browser's language: English, Chinese, or Spanish.

## Alternatives considered

**Draw with content scripts or `chrome.scripting` on every page, as Claude in Chrome does.** That needs `<all_urls>` host access, which Chrome warns about and which disables the installed extension until each user re-approves it. The debugger the extension already holds while it acts draws in the same tabs without a new grant.

**Keep the indicator up for the whole turn, even after the debugger detaches.** That would mean holding the debugger, and with it Chrome's debugging bar, through every pause between steps, or attaching again only to draw. The indicator therefore follows the debugger, except the waiting tag, which is left on the page when the debugger detaches.

**Prefix the page title with `Æven · `.** It reads well in the tab strip, but the browser stores the prefixed title in the history and in bookmarks made meanwhile. The tab-group mark carries the state instead.

**Hide the indicator from the model's screenshots.** Deferred at the reader's request. The tag and glow appear in screenshots the agent takes of the tab.

## Consequences

- The indicator, the group marks and the notifications reach readers with extension 0.3.38, together with the WebSocket and native messaging fallback. The `input` and `done` notices need a desktop app or web client with this change; with older ones, the indicator and ⌛ marks still work.
- A tab whose debugger detached while a step waited keeps the waiting tag, glow and icon until the page navigates or the agent acts again, because removing them needs the debugger.
- A `done` that arrives after the debugger detached shows only the notification and the ✅ mark.
- The group mark is shared by every agent tab in the window, so it shows the latest state of any of them.
