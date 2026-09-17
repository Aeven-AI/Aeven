# Agent Note: Web Preloader Waits for Shell Data

Status: implemented

English | [中文](2026-09-08-web-preloader-waits-for-shell-data.zh.md)

## Problem

A reload of a conversation URL hides the static shell preloader as soon as the client plugin tree has activated and React owns the mount point. The first Workspace list, Session list, and selected history page still arrive after that handoff, so the fade uncovers an empty sidebar ("No sessions yet") and a blank conversation column. The [static Web shell preloader](2026-09-02-static-web-shell-preloader.md) already covers first paint before JavaScript; it does not cover that first Remote payload.

## Decision

`AppWebEntry` still mounts the application after every client entry is ACTIVE, then waits on `ctx.uiWorkspace.whenInitialDataReady()` before fading `#avn-preloader`. That waiter resolves once both list projections have left `pending` (a Workspace stream error counts as arrived), initial URL or recent-Workspace navigation has finished, and the selected Session's `openState` is `open` or `error`. No selected Session is a ready empty shell. Later navigation does not restore the overlay. A composition without `uiWorkspace` still fades immediately after mount. Authentication screens and boot failures still hide immediately. The waiter also resolves on plugin disposal so boot cannot hang behind teardown.

The wait is the first list baselines and the selected history page only. Older-history pagination, images, and later catalog refreshes stay off the critical path. Boot yields one macrotask after the waiter so the mounted shell can commit that payload before the 400ms fade starts.

## Verification

Workspace unit tests cover a ready empty shell, a selected Session that opens or errors, a late-appearing Session face, a Workspace stream failure, the initial connect path, and disposal. Boot unit tests keep the static element visible until `whenInitialDataReady` resolves and fade immediately when the service is absent or does not wait.

## Alternatives considered

**Hide from ConversationRoot or AppFrame once React has committed.** That couples a framework-free overlay to a specific slot tree and leaves compositions without those occupants with a stuck preloader unless boot still owns a fallback.

**Wait only for plugin activation, as the original preloader decision did.** That is the defect: harness-ready is earlier than sidebar-and-content-ready.

**Block mount until the payloads arrive.** The application would not subscribe or start the history open until after the wait, adding a serial delay the current order (mount, then wait on stores that are already fetching) avoids.

## Consequences

A slow first list or history round-trip keeps the branded overlay up instead of flashing empty chrome. A first pull that never arrives keeps the overlay until disposal. Worker preview and documents without `#avn-preloader` are unchanged. The [static preloader note](2026-09-02-static-web-shell-preloader.md) still owns first-paint markup and CSS; this note owns when a successful Web boot dismisses that visual.
