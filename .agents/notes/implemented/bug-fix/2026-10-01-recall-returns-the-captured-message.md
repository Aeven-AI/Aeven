# Agent Note: An explicit memory search returns the captured message

Status: implemented

English | [中文](2026-10-01-recall-returns-the-captured-message.zh.md)

## Problem

`traceSnippet` — what an explicit search shows for one trace — returned the distilled summary, the tool record, and the assistant answer, but never `trace.userText`: the message capture stored, from which the summary was distilled. `hitOrigin` then chose the summary alone for `person` memory even on an explicit search, so the one domain whose memories are most often quoted back returned the least verifiable text.

Both recall paths therefore answered from a distillation, and a distillation drops things. Measured in the memory benchmark: a `temporal` probe searched memory three times for a release ordering taught in the teaching session (`release versions shipped order timeline aurora`, `aurora-u30eu8 release shipped after`, and one broadening query). Each result returned the same summary — it named the channel, the codename, and the region, and not the ordering — and the probe abstained. The ordering was in the trace's `user_text` throughout, one `memory_get` away, under a tool the probe never called: `recall-detail.spec.ts` names the same case at unit level.

This was the suite's only failure: 20/21 correct in the memory arm against 3/21 in the control, with `temporal` at 2/3.

## Decision

An explicit search returns the trace whole: the stored summary, then the captured message, then stored tool inputs, outputs, and assistant answers. Automatic recall keeps stating the summary alone, because it is injected into every turn and the message has no per-item bound of its own ([rationale](../feature/2026-10-01-memory-summary-recall.md)). The `person` exception is removed: an explicit search returns the captured message for every domain.

`packages/memory/memory-memos/tests/recall-detail.spec.ts` pins all four facts: an explicit search returns the captured message, it does so for a `person` memory too, it labels the message so a reader can tell it from the summary above it, and automatic recall still states only the summary. The fake MemOS core the recall specs share moves to `tests/harness.ts`, which is where `userText` becomes part of the fixture.

## Alternatives considered

- **Make the summarizer faithful.** The distillation belongs to the pinned MemOS core and is lossy by construction; the store keeps the message, so the repair belongs where the loss becomes visible rather than in a prompt we do not own.
- **Put the captured message into automatic recall.** It is injected on every turn, and a message is unbounded where a summary is not; the search is where an agent goes when the summary it was handed does not hold what it needs.
- **Have the search result point at `memory_get`.** The recall block already says "Use memory_get with an id to read a memory in full", and the measured probe read that block three times without using it. Repeating the hint does not put the fact within reach.

## Consequences

A search result carries more text, bounded by `tool-memory`'s `resultMaxChars` (1200 by default) rather than by the summary's own length. Automatic recall's content and cost are unchanged, so the every-turn path pays nothing for the fix.

A fact a summary drops is now reachable in the same call that finds the memory, without a second lookup the agent has to decide to make. The summary keeps its role: it is what recall ranks and injects, not what a deliberate lookup is limited to.

## Verification

`pnpm exec vitest run packages/memory/memory-memos` passes 13 tests across 3 files, including the four new cases; `npx tsc -p tsconfig.host.json --noEmit` exits 0. `pnpm run benchmark:memory --abilities temporal,prior-session --runs 3` re-runs the abilities this change affects.
