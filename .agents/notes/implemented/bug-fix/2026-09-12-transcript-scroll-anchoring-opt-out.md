# Agent Note: Transcript scrollports opt out of browser scroll anchoring

Status: implemented

English | [中文](2026-09-12-transcript-scroll-anchoring-opt-out.zh.md)

## Problem

Switching Sessions left the transcript short of the tail. On the running Web client, selecting another Session from the sidebar and then walking browser history Back and Forward between `/c/2cc5bd5e…` ("Overview of new AVN changes since fork") and `/c/38c398db…` ("The current performance of this") produced, every time and in both directions:

| transition | distance from the floor |
|---|---|
| open `2cc5bd5e` | 0.5 px |
| select `38c398db` from the sidebar | 0 px |
| Back to `2cc5bd5e` | 150.5 px |
| Forward to `38c398db` | 1616 px |
| Back to `2cc5bd5e` | 150.5 px |

Each landing was stable — the offset never drifted afterwards, and the back-to-bottom control stayed on screen — so this was not a race that resolves itself, and history navigation is not the trigger: a sidebar click into the same Session reproduced it once the Session had been opened earlier in the page's life.

`ChatView` owns this scrollport's offset through a ledger of its own writes. `onScrollRef` treats an offset that moved without a matching programmatic write as reader input (`movedByReader`), and reader input away from the floor releases bottom-follow: `atBottomRef.current` becomes `false`, a `reflowAnchorRef` is recorded, and from then on both re-pin paths — the `ResizeObserver` follow (`followRef`) and the activation tail correction — decline to act because each requires `atBottomRef.current`.

Instrumenting the `scrollTop` setter of every element while the failing switch ran showed only two writes, and neither explains where the transcript ended up:

```
toBottom                      assigned 5052 (scrollHeight), applied 4375 (the floor of that moment)
ResizeObserver compensation   assigned 6725, applied 6725   33 ms later
```

The activation `toBottom` runs in a layout effect while the transcript is still filling, so it reads a short flow: 5,052 px against the final 9,018 px on `38c398db` (6,986 px against 14,487 px on `2cc5bd5e`). The remaining rows land later in the same frame, and browser scroll anchoring then holds its chosen anchor node still by adjusting the offset from 4,375 to 6,725 — a scroll event reported 6,725 two milliseconds *before* any JavaScript wrote that value. The ledger cannot see that adjustment, so the sample read it as a gesture, released bottom-follow, and the transcript settled 1,616 px above the tail with nothing left to correct it. Injecting `overflow-anchor: none` on the scrollport at runtime under the same flow made every landing 0 px, which identified the writer.

## Decision

Both transcript scrollports opt out of browser scroll anchoring:

- `.scrollBody` in `packages/client/ui-conversation/src/client/skeleton/ConversationRoot.module.css` — the resident scrollport carrying `data-conversation-scroll`, which owns scrolling for the conversation column.
- `.scroll` in `packages/client/ui-chat/src/client/chat/ChatView.module.css` — the box ChatView owns when no `[data-conversation-scroll]` host wraps the view.

CSS Scroll Anchoring Level 1 §2.1 makes this the switch for the whole scrolling box: when the element generating the scrolling box computes `overflow-anchor: none`, no anchor node is selected for it, and per §3 a descendant scroll container "turns it back on" for its own scrolling box — so a code block or ledger nested inside the transcript keeps its own anchoring.

Nothing is given up by the opt-out, because ChatView already anchors the same way for itself. A reader away from the floor has a `reflowAnchorRef` recorded from their last sampled scroll, and the `ResizeObserver` restores that row's offset on every observed height change (the flow column and the composer seat); a reader at the floor is re-pinned by `followRef`. The browser's adjustment was a second writer of the same property, invisible to the ledger that decides follow ownership, and it is the writer that broke.

## Verification

Reproduced and fixed against the running Web client over CDP, on the same two Sessions and the same flow (`open A` → `select B` → Back → Forward → Back → Forward):

- Before the change: 0, 0, 150.5, 1616, 150.5, 1616 px from the floor.
- With `overflow-anchor: none` injected on `[data-conversation-scroll]` alone: 0 px at every step, confirming the spec's scroller-level switch is sufficient and that no descendant selector is needed.
- After the CSS landed and both client bundles were rebuilt (`pnpm --filter @aeven/client-ui-conversation bundle`, `pnpm --filter @aeven/client-ui-chat bundle`, served with new revisions on reload): 0 px at every step, including the sidebar click into a Session that was already open.
- Reading position survives the opt-out: with the reader 4,000 px above the floor, inserting 700 px of content above the viewport left the reading row at the same scrollport offset (−39 px before and after) and the distance from the floor unchanged, so ChatView's own reflow anchor still owns that case.
- Reading up and switching away still starts the next activation at the tail (0 px), which is the Session-activation scroll policy unchanged.
- `AVN_SNAPSHOT=replay vitest run --config vitest.web.config.ts apps/web/tests/chat-scroll-contract.e2e.ts` reports 5 failures where the pristine stylesheet reports 6. `starts ordinary Session switches at the live tail` is the regression itself: against the unmodified stylesheet it misses the floor by 228 px (`expected 228 to be less than or equal to 1`), and with this change it passes. The remaining five fail identically before and after — `preserves the reader anchor when history and streaming arrive concurrently`, `offers every outline turn on the rail and jumps to an unloaded one`, `keeps streaming ownership and tool disclosure state across a long scroll-away cycle`, `restores tab/session position and keeps composer resizing on the correct scroll owner`, and `keyboard paging owns bottom-follow without wheel input` — and no cause is established for them here.
- Both client bundles rebuild clean (`tsdown`, 116 ms and 177 ms).

## Alternatives considered

**Tell reader input from real input events (wheel, key, pointer, touch) instead of the offset ledger.** The ledger exists precisely to avoid naming devices: it also covers scrollbar drags, keyboard paging, focus-driven `scrollIntoView`, and browser find, none of which emit a single event type. Naming devices would narrow the signal rather than fix it, and the anchoring adjustment carries no input event at all, so the signal would still need a second source.

**Re-pin after activation until the transcript settles (an authority window).** The activation path already corrects once on the next frame; extending it into a window means deciding when the window ends and how a reader gesture arriving inside it pre-empts the correction, which is the same ownership question asked later. It also leaves the anchoring adjustments that fire during the window unaddressed.

**Re-assert the tail from the `ResizeObserver` whenever the recorded reflow anchor is the tail row.** It infers intent from which row was anchored, so a reader who genuinely stops on the last row can no longer scroll up without being snapped back, and the browser's adjustment has already moved the offset by the time the observer runs.

**Set `overflow-anchor: none` on the transcript's rows instead of the scrollport.** Measured to work, but it excludes anchor candidates one subtree at a time: every row element and every future row wrapper would have to carry it, and a single omission silently restores the old behavior for that row.

**Toggle the opt-out per scroll position, keeping anchoring while the reader is away from the floor.** Changing the property invalidates the anchor node, so the browser would re-select exactly when the reading position matters most, and the app's own reflow anchor already serves that case.

## Consequences

Session switches now land on the tail and stay there while the transcript finishes laying out, and the ledger's premise — an offset ChatView did not write came from the reader — holds for the transcript scrollport again.

Reading-position stability away from the floor now rests entirely on ChatView's reflow anchor. That compensation runs on observed height changes of the flow column and the composer seat, so a layout change that moves the reading row without changing the column's height — content above the viewport growing while an equal amount shrinks elsewhere inside a single frame — no longer has a second mechanism behind it. If the transcript ever needs the browser's anchoring again, the reintroduction condition is a follow-ownership signal that can tell an anchoring adjustment from a reader gesture, not a narrower CSS scope.

Engines without scroll anchoring ignore the declaration, so this changes behavior only where anchoring exists.
