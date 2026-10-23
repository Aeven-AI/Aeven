# Agent Note: Compaction fits the summary to the endpoint

Status: implemented

English | [中文](2026-10-23-compaction-fits-the-summary-to-the-endpoint.zh.md)

## Problem

The summary call replays the span it condenses, so its own request carries that span. An endpoint that refuses the span for size — `CONTEXT_WINDOW_EXCEEDED` for the token budget, `MESSAGE_COUNT_EXCEEDED` for the admitted message count — refuses the same request again on every retry, unchanged. Overflow recovery had one maximal balanced head as its only option, so a refused summary left the turn with no way to continue: the reduction that would fit was smaller than the span the endpoint had just rejected, and nothing selected it.

## Decision

`halveRange` in `packages/compaction/compaction-basic/src/region.ts` selects the largest head of a chosen range that holds at most half the range's route-priced tokens: it sums the range's token-meter nodes, takes the leading nodes until the next one would pass half, steps the end back until `toolPairingBalancedAfter` holds, and returns `null` when the head would be fewer than two nodes. A head of two or more nodes always shortens the surface, because one checkpoint replaces them. A measurement whose nodes do not match the session surface throws rather than halving a span the meter did not price.

`compactFitting` retries the summary with that smaller head on exactly those two codes. It rethrows without a retry when the signal is aborted or the failure carries any other code, and it rethrows the original error when `halveRange` finds no head, so a span a single tool pair makes indivisible still reports the provider's failure.

Overflow recovery condenses until it reaches the range it first selected. Each pass selects a compactable range on the current surface, calls `compactFitting`, and — when the committed result's `shadowedRange.end` falls short of the selected range's end — re-measures and condenses the remainder together with the checkpoint that replaced the head. Pressure compaction calls `compactFitting` inside its own attempt loop and re-measures against the routed threshold after each attempt, so a halved head counts as that attempt's progress.

## Alternatives considered

**Retry the refused span unchanged and report the provider error.** The span stays the same size and the endpoint refuses it again, so an overflowed turn ended in an error even though a smaller head would have been summarized. Halving costs one more summary attempt and keeps the turn alive.

**Select a smaller head up front on every overflow.** Most endpoints accept the full compactable range, and compacting less than they accept discards less history than needed on the common path; the first attempt therefore uses the full range and halves only after a size rejection.

## Consequences

- A size rejection costs one more summary attempt per halving inside the same turn instead of ending it; the halving is bounded by the range, because every step removes at least one node from the head.
- One overflow recovery can land several checkpoints: the loop runs until the shadowed range reaches the original end, so a session records more than one `compaction/summary` event in a single recovery.
- The halved head leaves the rest of the range verbatim, so the remainder is condensed next with the checkpoint rather than rewritten in one request; the surface after recovery holds one checkpoint per pass.
- A range that no balanced head shrinks — an oversized tool pair, a range with no two-node head under half — still throws the original provider error, and the turn reports it.
- `packages/compaction/compaction-basic/tests/compaction-basic.spec.ts` pins the half-token budget, the step back onto a balanced tool-call boundary, the mismatch throw, both null cases, a retry for each of the two codes, the rethrow for another code, for an aborted signal, and for a range with no smaller head, and the loop that re-measures the remainder until the shadowed range reaches the original end.
