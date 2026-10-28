---
description: "Right sidebar browser: an Electron webview guest for HTTP(S) pages beside a session, its chrome, and the agent's browser automation."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-browser

English | [中文](README.zh.md)

## Summary

The right sidebar's browser pane, for a session viewed in the Electron desktop shell. The pane embeds an Electron `<webview>` guest and drives it from its own chrome: an address bar that resolves what the reader types into an address or a search, back, forward, reload, open-DevTools and zoom controls, a search-engine row in Settings → General, and a link menu that sends a clicked link to this pane, to the Host's Chromium, or to the operating system's browser. Sign-ins and site data are kept per Aeven account, so a site signed in to once stays signed in beside every session and after a restart. While the agent works, its pointer is held over the pane and draws where each action aims. The same guest answers the agent's `browser_*` tools through the `browser/automation` Remote Event, so the model drives the page the reader is looking at. Served over HTTP there is no webview and no shell bridge: the browser kind opens the Host's Chromium window instead, and a link opens in the tab itself.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Model Experience

### Browser automation

#### What the model sees

The session's page through the `browser_*` tools: the address, title, and load state a status or navigate returns, and the JSON result of each action performed in the guest; the tool schema and its wording belong to `avn-tool-browser`.

#### Token effect

Only the tool results `avn-tool-browser` renders reach a request; the pane's chrome, menus, and pointer add no text.

#### KV Cache effect

None; the pane draws state the session already logged.

## Known Limitations and Deferred Work

- **The embedded guest requires the desktop shell** — a web page has no `<webview>` and no shell bridge, so the browser kind opens the Host's Chromium instead and the pane's link menu is not installed.
- **A session with no mounted pane has no page** — the automation event passes on and the tool reports the browser closed, so the agent drives this pane only while the reader has it open.
- **Invariant omission** — No invariant companion is published because this package keeps no host-side state: the Host half registers one settings namespace and reads one Remote, while the guest, its link handling, and the automation replies exist only in the page and leave with it.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
