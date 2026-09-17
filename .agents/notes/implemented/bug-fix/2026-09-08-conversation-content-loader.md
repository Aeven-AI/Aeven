# Agent Note: Conversation Content Loader Overlay

Status: implemented

English | [中文](2026-09-08-conversation-content-loader.zh.md)

## Problem

While a Session's first history page is opening, ChatView rendered the localized "Loading history…" line in the transcript column. A Session switch therefore flashed empty or stale content and a text placeholder instead of covering the conversation column until the new history arrived. An already-open Session still remounts ChatView, so a switch between two in-memory Sessions stalls on that commit with no cover. The column overlay also painted under `#avn-preloader` during its 400ms fade, so two spinners were visible at once.

## Decision

`ConversationRoot` presents the Aeven content-loader spinner while a selected non-hero Session has not painted. ConversationRoot owns the `<header>` element so that shell stays mounted across switches; the session header slot fills the title row. The overlay is a CSS-only fixed layer from `top: 0` to `bottom: 0`. Its `100cqi` width follows the AppFrame center column as the sidebar slides, while the inherited details-column width anchors its right edge. It therefore spans the complete conversation column from the browser viewport's first vertical pixel without covering the sidebar or details column; it passes behind the composer seat rather than over it, per the [stacking decision](2026-09-09-content-cover-behind-composer.md). Painting completes two animation frames after `conversation.session` is mounted and `openState` is `open` or `error`. Showing is synchronous so a Session switch covers the transcript on the same frame. ConversationRoot, the session header, and the composer stay mounted: `session-maybe` keeps that incarnation across Session switches, and the header title comes from the Session list. Only `conversation.session` (ChatView) drops on the overlay frame and remounts two animation frames later, once the spinner has been presented. While that slot is dropped, an empty `.transcriptHold` with the same `flex: 1 0 auto` as active `.viewArea` stays as the scroll-body sibling so the sticky composer remains docked; without it the seat is the only flex child and sits at the top of the column. Returning to a Session that was painted earlier still covers the remount. Hiding fades opacity for 400ms, then unmounts.

The overlay stays inactive while `#avn-preloader` is in the document without `.screen-hidden`, including the 400ms page-preloader fade. Once that element is `.screen-hidden` or absent, the overlay appears if the column is still unpainted. The session body keeps mounting under the page preloader so history can paint beneath it.

The overlay uses `--dsw-alias-bg-base` and `--dsw-alias-label-primary`. Its accessible name is `content.loading`. ChatView does not render a history-loading line.

## Verification

ConversationRoot tests cover a loading Session, a cold selected Session, a summary-blank hero exemption, paint-then-400ms fade, an already-open Session switch that drops the body until the overlay is presented then remounts, the transcript hold sitting as the composer's previous sibling during that drop, the overlay sitting outside the header and composer in the document structure, a fading `#avn-preloader` suppressing the overlay, and the overlay appearing once that element is `.screen-hidden`. ContentLoader tests cover an immediate show, a fade-out, and cancelling a fade when another Session starts loading. Content-cover tests cover paint wait, hero exemption, deferred switch remount, preloader fade and screen-hidden handoff, returning to a previously painted Session, and missing `requestAnimationFrame`. ChatView's open-error case still asserts the error line and asserts the old history-loading copy is absent. Chrome verification during a Design system-to-WebOS switch confirms the fixed loader is `1448 × 941` at `(280, 0)` when the sidebar is open and `1728 × 941` at `(0, 0)` when it is closed, exactly matching the center column in both states.

## Alternatives considered

**Keep the in-flow text placeholder.** It does not cover the column, so a Session switch still flashes empty chrome.

**Reuse the static page preloader.** That visual is document-scoped and already dismissed after the first shell payload; restoring it on every Session switch would cover the sidebar.

**Put the overlay only in ChatView.** Trajectory and other session views would not be covered, and the overlay would remount with ChatView instead of covering the resident column on the switch frame.

**Cover only `cold` and `loading`.** An already-open Session still remounts ChatView; that commit is the stall a switch between in-memory Sessions shows.

**Keep calling `conversation.session` until two frames after the overlay shows.** That slot reads the current Session, so the call remounts ChatView in the overlay's first commit.

**Wrap `conversation.session` in a permanent flex hold.** Overlay CSS requires `[data-slot='conversation.session']` as a direct `.scrollBody` child; `display: contents` on an empty hold would again leave no growing flex item.

**Remount ConversationRoot on every Session switch.** The title is already in the Session list and the composer is resident; tearing the shell down waits on the same Session-face work the transcript needs.

**Decide hero vs docked from Session/Conversation snapshots.** Those bind after the list; a missing Conversation snapshot makes `shellPhase` blank and an already-open Session looks like the empty hero, so the input leaves the dock for a frame.

**Show the column overlay during the page-preloader fade.** The page preloader is already covering the document; a second spinner peeks through as that overlay's opacity drops.

## Consequences

Session switches cover the full height of the conversation column immediately, including already-open history and the composer region, while the sidebar and details column remain outside the loader. The session header and composer stay mounted and update in place from the Session list; the input stays docked while ChatView remounts because the transcript hold occupies `.viewArea`'s flex item. Hero vs docked composer is decided from that list (`blank`), not from Session or Conversation snapshots, so the input does not leave the dock while those snapshots bind. A proven-blank New Session still opens on the hero without a spinner. Reduced-motion unmounts the overlay without the 400ms fade. First load under `#avn-preloader` does not show a second spinner; if ChatView is still unpainted when that element becomes `.screen-hidden`, the center-column overlay appears.
