# Agent Note: Conversation Content Loader Overlay

Status: implemented

English | [中文](2026-09-08-conversation-content-loader.zh.md)

## Problem

While a Session's first history page is opening, ChatView rendered the localized "Loading history…" line in the transcript column. A Session switch therefore flashed empty or stale content and a text placeholder instead of covering the conversation column until the new history arrived. An already-open Session still remounts ChatView, so a switch between two in-memory Sessions stalls on that commit with no cover. The column overlay also painted under `#dsh-preloader` during its 400ms fade, so two spinners were visible at once.

## Decision

`ConversationRoot` overlays the transcript (not the sidebar, session header, or composer) with the Aeven content-loader spinner while a selected non-hero Session has not painted. ConversationRoot owns the `<header>` element so that shell stays mounted across switches; the session header slot fills the title row. The overlay sits in `.body` with `top: 56px` in the active phase so it does not show through the transparent 56px header, and `bottom: var(--dsh-composer-height)` so it stops above the input. Painting completes two animation frames after `conversation.session` is mounted and `openState` is `open` or `error`. Showing is synchronous so a Session switch covers the transcript on the same frame. ConversationRoot, the session header, and the composer stay mounted: `session-maybe` keeps that incarnation across Session switches, and the header title comes from the Session list. Only `conversation.session` (ChatView) drops on the overlay frame and remounts two animation frames later, once the spinner has been presented. While that slot is dropped, an empty `.transcriptHold` with the same `flex: 1 0 auto` as active `.viewArea` stays as the scroll-body sibling so the sticky composer remains docked; without it the seat is the only flex child and sits at the top of the column. Returning to a Session that was painted earlier still covers the remount. Hiding fades opacity for 400ms, then unmounts.

The overlay stays inactive while `#dsh-preloader` is in the document without `.screen-hidden`, including the 400ms page-preloader fade. Once that element is `.screen-hidden` or absent, the overlay appears if the column is still unpainted. The session body keeps mounting under the page preloader so history can paint beneath it.

The overlay uses `--dsw-alias-bg-base` and `--dsw-alias-label-primary`. Its accessible name is `content.loading`. ChatView does not render a history-loading line.

## Verification

ConversationRoot tests cover a loading Session, a cold selected Session, a summary-blank hero exemption, paint-then-400ms fade, an already-open Session switch that drops the body until the overlay is presented then remounts, the transcript hold sitting as the composer's previous sibling during that drop, the overlay sitting outside the header and composer, a fading `#dsh-preloader` suppressing the overlay, and the overlay appearing once that element is `.screen-hidden`. ContentLoader tests cover an immediate show, a fade-out, and cancelling a fade when another Session starts loading. Content-cover tests cover paint wait, hero exemption, deferred switch remount, preloader fade and screen-hidden handoff, returning to a previously painted Session, and missing `requestAnimationFrame`. ChatView's open-error case still asserts the error line and asserts the old history-loading copy is absent.

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

Session switches cover the transcript immediately, including already-open history. The session header and composer stay mounted and update in place from the Session list; the input stays docked while ChatView remounts because the transcript hold occupies `.viewArea`'s flex item. Hero vs docked composer is decided from that list (`blank`), not from Session or Conversation snapshots, so the input does not leave the dock while those snapshots bind. A proven-blank New Session still opens on the hero without a spinner. Reduced-motion unmounts the overlay without the 400ms fade. First load under `#dsh-preloader` does not show a second spinner; if ChatView is still unpainted when that element becomes `.screen-hidden`, the transcript overlay appears.
