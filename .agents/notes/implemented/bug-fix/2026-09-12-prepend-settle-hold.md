# Agent Note: Hold the reader's row while a prepended page settles

Status: implemented

English | [中文](2026-09-12-prepend-settle-hold.zh.md)

## Problem

A history page that arrives while the reader is away from the floor left their row offset by whatever height landed after the compensation.

The reference scenario holds `POST /api/session/page` while a live turn streams, then releases it: `ChatView` compensates the prepend, and the reader's row must stay where it was. Measured on that scenario, with the app's own anchor decisions instrumented:

```
2457  prepend   key=13:input-message…  anchorTop=-102  delta=7772   scrollHeight=22643
2491  sample    reflowKey=14:assistant-step55:1  top=-795        scrollHeight=28155
```

The compensation ran against a flow of 22,643 px and moved the reader 7,772 px. Thirty-four milliseconds later the same page measured 28,155 px, so the row the reader was on had moved a further **5,512 px** — and the residual was permanent. The `scroll` event the compensation itself produced scheduled a sample, and that sample re-derived `reflowAnchorRef` from the position the partial compensation had left: the row then at the top edge, which the arriving page had just inserted. Every later `ResizeObserver` pass corrected *that* row (delta 0, 4,412 times) while the reader's row stayed 5,206 px lower than where they left it.

The prepended rows lay out in more than one commit, so a compensation that runs on the first one cannot know the page's final height. What it can do is keep aiming at the row it started from.

## Decision

The prepend branch records the row and offset it compensated for in `prependHoldRef`, and the settle hold outranks the derived anchor until the reader takes over:

- `prependHoldRef.current = anchor` in the prepend branch, next to the existing `scrollTop` write.
- The `ResizeObserver` compensation resolves `prependHoldRef.current ?? reflowAnchorRef.current`, so the height that lands after the first commit is corrected against the reader's row and its target offset rather than against an inserted row.
- The scroll sample skips re-deriving `reflowAnchorRef` while the hold is set, and drops the hold as soon as the reader moves (`movedByReader`). `toBottom` clears it with the other anchors.

The hold is written in exactly one place — a branch that already requires a pending paging anchor and a decreased head sequence — and read in exactly one place. With no prepend it is `null`, and the observer behaves as before; any reader gesture returns the anchor to the derived row on the next sample.

## Verification

A/B on `apps/web/tests/chat-scroll-contract.e2e.ts`, same tree, same bundles, only the hold statement toggled:

| | scenario under test | file result |
|---|---|---|
| hold active | passes (reader's row within the 2 px tolerance) | 6 passed, 1 failed |
| hold disabled | fails, row moved 5,402 px | 5 passed, 2 failed |

The one failure on both sides is `restores tab/session position and keeps composer resizing on the correct scroll owner`, which fails for an unrelated reason recorded under Consequences.

`packages/client/ui-chat/tests/chat-view.client.spec.tsx` — 97 tests pass with the hold active and with it disabled, so the change moves no unit-visible behavior. `packages/client/ui-chat` and `packages/client/ui-conversation` pass.

## Alternatives considered

**Wait for the page's layout to settle before compensating.** There is no settle signal to wait on: the rows land in successive commits without any event that says "this page is complete". The `ResizeObserver` already is that signal, so the fix belongs where the later passes can still reach the reader's row.

**Re-derive the reflow anchor only from reader-driven samples, for every write.** The ledger cannot name the writer: a compensating write and a reader scroll both arrive as a changed offset, and the sample deliberately infers ownership from that difference rather than from input devices. Scoping the rule to a settling prepend keeps the inference intact everywhere else.

**Correct the residual from the observer by comparing against the pre-prepend height.** It would need the height of the flow before the page arrived, which the app does not keep, and the same bookkeeping as the hold with more arithmetic.

**Leave it as it was.** The drift is permanent and proportional to the page, so a reader who pages history while a turn streams silently loses their place — the behavior the scenario exists to prevent.

## Consequences

A reader who pages history — or who has a page arrive under them while a turn streams — keeps their row through the whole arrival, whatever the page's final height is.

The hold makes the *pre-prepend* row authoritative until the reader scrolls, so while it is set the app no longer tracks the row at the top edge. If that row leaves the DOM (a trim, a fold that hides it) the hold simply stops matching and the next reader scroll re-derives the anchor; it cannot hold the reader against their own gesture, because any reader scroll clears it.

The remaining red scenario, `restores tab/session position and keeps composer resizing on the correct scroll owner`, is **not** addressed here. It asserts that a row captured before a 1680 → 700 px viewport change keeps its offset across a tab switch; the restore itself is exact (the row is pinned to its recorded offset, measured at −96 px into the viewport before and after), but the reflow that follows holds the row at the top edge, whose own height changes when the narrower column re-wraps, moving rows below it by 516 px. Keeping a nested row fixed through a width change means choosing a different anchor row for that reflow, which is a product decision rather than a consequence of this one.
