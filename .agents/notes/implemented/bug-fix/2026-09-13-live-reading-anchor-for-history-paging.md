# Agent Note: One live reading anchor holds history paging

Status: implemented

English | [中文](2026-09-13-live-reading-anchor-for-history-paging.zh.md)

## Problem

Scrolling up quickly through a long Session loaded history in the wrong place: each arriving page threw the reader thousands of pixels away from the row they were reading, and the jump showed in the transcript on every page.

Measured over CDP on the running Web client with a 250 px-per-frame upward fling, one page arrival grew the flow from 10,402 px to 66,213 px while `scrollTop` moved only 4,430 px, and the row at the reading line landed 381 px to 919 px away from where the reader left it. Two independent defects combined:

- `ChatView` kept three anchors. `anchorRef` captured the reader's row and its viewport offset when a page request started, `prependHoldRef` pinned that capture until the next sampled scroll, and `reflowAnchorRef` was refreshed only by the 500 ms scroll sample. A reader still scrolling while the request was in flight was restored to the pre-request offset, and the commit-time compensation was skipped outright while a scroll sample was pending.
- Settled Assistant rows changed height after mount. The engine's `Reasoning` block initialised `open` to `true` and closed itself in an effect, and `MarkdownText` wrote settled text into the engine from a passive effect. Every settled reasoning trace was laid out fully expanded for one frame: a Session switch measured 59,207 px collapsing to 9,860 px, and each prepended page did the same.

## Decision

`ChatView` keeps one `ReadingAnchor`: the row at the scrollport's top edge with its top in scroll-content coordinates (`flowTop(row) + scrollTop`). Scrolling never changes that value; only layout above the row does. `holdAnchorRef` shifts `scrollTop` by exactly the row's movement since the last capture and re-captures, and it runs on every ChatView commit (before the pending-sample early return), every observed height change, and every scroll frame. The observed-top ledger moves by the applied shift alone, so reader input between samples still reads as reader input. Programmatic landings re-capture instead of clearing holds. `prependHoldRef`, `reflowAnchorRef`, and `heldPagingAnchor` are deleted.

A pinned reader reads no layout in the hold: the follow path owns the floor, so streaming commits pay nothing. Away from the floor a frame normally costs two rect reads; the hit test runs only after the anchored row leaves the top edge.

Settled rows mount at their final height:

- `Reasoning` derives `open` during render as the reader's toggle when there is one, otherwise `stream === true`, and the collapse is `.reasoning-wrapper.collapsed .reasoning-content { display: none }` on a trace that stays mounted.
- `MarkdownText` passes settled text to `HyperMarkdown` through `md`, which the engine builds in its constructor, and applies later text changes in a layout effect.

Automatic paging starts within four scrollport heights of the window head, with a 1,500 px floor. The paging spinner slot starts below the 56 px Session header, which previously covered it.

## Verification

Against the running Web client over CDP after rebuilding the affected bundles:

- Session switches paint the transcript once at its final height (14,348 px, 9,860 px, 10,402 px) and settle 0 px to 1 px from the floor.
- A 200-frame fast fling adds pages of 7,832 px to 10,479 px with no collapsing spike; on landing frames where the reading-line row is unchanged it moves 0 px.
- A rail jump to Turn 1 through unloaded history lands the Turn and stays there 1.5 s later.
- While a page loads, the spinner is the topmost element at its centre, 58 px from the scrollport top.

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` models row rects in content coordinates for the prepend and fallback cases, and `packages/client/hypermarkdown/tests/correctness/reasoning.client.spec.ts` pins the collapsed settled mount.

## Alternatives considered

**Re-enable browser scroll anchoring.** It keeps the reader's row natively, but its adjustments arrive as scroll events the follow ledger cannot attribute, which is the Session-switch regression recorded in [the opt-out note](2026-09-12-transcript-scroll-anchoring-opt-out.md).

**`flex-direction: column-reverse` on the scrollport.** Prepends would not move the reading position, but the rail jumps, search landing, saved positions, and follow ledger all assume a top-origin `scrollTop`, so the change would rewrite every scroll consumer.

**`content-visibility: auto` on rows.** It cuts off-screen rendering cost, but intrinsic-size estimates change row heights as rows render, which is the size instability this change removes.

## Consequences

The [prepend settle hold](2026-09-12-prepend-settle-hold.md) is superseded: the live anchor keeps the reader's row through every commit of a settling page without pinning a pre-request position.

Compensation still keys on the row at the top edge, so a layout change that hides that row (a Turn-process fold) re-selects the anchor without compensating that frame.
