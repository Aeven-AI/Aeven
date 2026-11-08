---
description: "The agent's browser engine: the preview_* operations over Chrome DevTools Protocol, with ChatGPT's pointer timing, shared by the sidebar browser, Chrome, and the Aeven extension."
kind: "package-reference"
---

# @aeven/browser-engine

English | [中文](README.zh.md)

## Summary

Performs the operations behind the `preview_*` tools on one browser tab over the Chrome DevTools Protocol: clicks, typing, scrolling, reading, waiting, snapshots, screenshots, dialogs, uploads, WebMCP, and navigation. The same engine drives the desktop app's sidebar browser (an Electron guest), a Chrome tab over a DevTools WebSocket, and a tab of the Aeven browser extension through `chrome.debugger`, so every browser the agent uses behaves alike. It imports neither Electron nor Node: what it may do on the computer (attach files, save downloads, use the clipboard) comes from the host as an `EngineHost`.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

`automate(target, operation, input, signal, host)` runs one operation on a `BrowserTarget` and returns its JSON result. A target is a CDP session plus the tab's address, title, key input, and `presentCursor(step, wait, timeoutMs, signal)`, which draws the agent pointer and, when asked, resolves once it has arrived. `ChromeTab` builds a target from any `TabChannel` (send a command, subscribe to events, report whether it is open) and draws the pointer with the overlay page script it is given; `prepareTab` enables the domains the engine listens to and installs that script in every document the tab opens.

An `EngineHost` with no members refuses file uploads, Google Docs exports, and clipboard access; the browser extension runs with such a host, the desktop app with one that reaches the computer's files, Downloads folder, and clipboard.

<a id="understand-the-implementation"></a>
## Understand the implementation

Pointer timing follows ChatGPT's browser agent: the pointer arrives (at most 1500 ms) before the page's mouse events, a click waits up to 3000 ms for a navigation that began within 250 ms, back, forward, and reload wait up to 10,000 ms, a drag waits for the pointer only at its first point, and a scroll sends one wheel event and returns once the scrolled position settles. A tab nobody can see gets no pointer to wait for. `page-scripts.ts` holds the page-side locator (CSS, `text=`, `role=`, `label=`, `xpath=`, `>>`, `nth=`, `visible=`), the markdown reader, and the YouTube caption reader.

## Known Limitations and Deferred Work

- **One tab per call** — an operation acts on the target it is given; choosing the tab is the caller's.
- **No cross-origin frame access beyond CDP's isolated worlds** — a `frame` argument reaches a same-process iframe; an out-of-process iframe is not addressed.
- **No invariant companion** — No runtime invariant companion is published because the engine keeps no state across calls beyond the tab it is handed; its callers' tests and live checks cover each operation.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

The timings are ChatGPT's browser agent's values, reimplemented from its observed behavior; change them only together with the overlay's motion, which the arrival waits depend on.

</details>
