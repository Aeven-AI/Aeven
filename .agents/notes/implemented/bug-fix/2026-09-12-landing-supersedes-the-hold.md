# Agent Note: A landing supersedes the prepend hold

Status: implemented

English | [中文](2026-09-12-landing-supersedes-the-hold.zh.md)

## Problem

A rail jump to an unloaded Turn landed and then slid away: the target row was reached, and seconds later the reader was back at the bottom of the transcript with the target far above the viewport. On a 52-Turn Session, clicking the top mark moved `scrollTop` from 8970 to 0 and then to 78,956 — the floor — leaving Turn 1 at −78,899 px.

Instrumenting every programmatic offset write on the live Session showed the shape of it:

```
30120  184975  83295  86477  87215  87953  …  91643  92381
```

After the landing write of `0`, the offset climbed by a **constant +738 px** per write until it reached the floor. The last writer of each step was `ResizeObserver.<anonymous>` — `ChatView`'s reflow compensation — not the landing path.

The compensation resolves its anchor as `prependHoldRef.current ?? reflowAnchorRef.current`, and the settle hold outranks the derived anchor by design (the `prepend-settle-hold` note). That hold is calibrated against the window as it was *before* the compensation write, and it is dropped by exactly two things: a reader scroll (`movedByReader` in the scroll sample) and `toBottom`. `landOnRow` cleared `reflowAnchorRef` and left the hold armed.

A landing is not a prepend, so nothing re-armed the hold for the landed position either: it kept the row it held before the jump and its pre-jump offset. Every later reflow therefore re-applied `flowTop(heldRow) - heldTop` to the newly landed offset — the reader's row was hundreds of px below the top after a jump to the origin, so each pass pushed them that much further down. It stops only at the floor.

## Decision

`landOnRow` clears the settle hold in the same place it clears the derived anchor:

- `prependHoldRef.current = null` in `landOnRowRef.current`, next to the landing write, so a landing invalidates every compensation anchor at once.
- The derived `reflowAnchorRef` continues to be set from the landed position below it, so the ordinary reflow path still holds the row the reader is actually looking at.

The two anchors are a pair whose only purpose is to hold a row through an asynchronous page. The landing is the moment that page's purpose is fulfilled, so both are dropped together rather than one of them surviving into a state nothing re-arms.

## Alternatives considered

**Clear the hold only on the settling landing (the `settle: true` call).** Mid-jump landings would keep correcting towards their own target, and those corrections are the same defect: they write offsets calibrated against the pre-landing window. The mid-jump landing also re-arms `anchorRef` for the next chunk, which is the mechanism that is supposed to carry the reader, so the hold is not what keeps a multi-chunk jump on course.

**Have the scroll sample re-derive the hold after a landing.** The sample infers ownership from the difference between the observed offset and the ledger; a landing write records itself in the ledger, so the sample sees no reader input and cannot tell a landing from a compensation. Re-deriving there would also fight the landing for the frames in which the page is still settling.

**Cap the compensation so it cannot cross the landed offset.** It treats the symptom: the correction is wrong in direction, not merely too large, and a magnitude cap leaves a residual that accumulates on every reflow.

**Leave it as it was.** The jump is the feature; a jump that lands and then loses the target is worse than a slow one, and the failure is proportional to the page that was paged in, so it is worst exactly where jumps matter most.

## Consequences

A rail jump lands and stays landed: measured on the live Session, `scrollTop` reaches 0 and the maximum offset observed afterwards is 0, with the target Turn's row 56 px below the scrollport top and unchanged after 2.5 s. Before the fix the same measurement ended at the floor.

The landing is now authoritative over both compensation anchors, so a page that is still arriving when the jump lands no longer moves the reader afterwards. That is the intended reading of a landing: the reader asked for a specific Turn, and the row they asked for is at the reading line.

The covered paths are the unloaded-Turn rail jump, the same landing after mid-jump chunks, and exact-event navigation from content search — every caller of `landOnRow`, which is the single place the anchors are now dropped.
