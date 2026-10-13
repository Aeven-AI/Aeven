# Agent Note: Superseded memory stays out of the recalled block

Status: implemented

English | [中文](2026-10-01-memory-supersession.zh.md)

## Problem

Recall can return a statement and the statement that replaced it in the same block. A region was recorded as one value, corrected later to another, and both traces are retrieved because both match the query; the block then asserts the current value and its obsolete predecessor side by side. A model reading that has no basis for choosing, and the failure is invisible in the block itself: retrieval worked, and the memory was no longer true.

The provider cannot resolve this. MemOS ranks candidates by relevance and does not know that two summaries describe one subject, so the choice falls to the consumer that frames the block.

## Decision

`@aeven/memory-context` retires the earlier of two memories that describe one subject, and orders by recency when relevance ties.

A recalled memory now carries the time it was recorded. `MemoryHit` gained an optional `recordedAt`, which `@aeven/memory-memos` fills from the trace's own timestamp; a memory whose provider reports no time competes on score alone.

Before rendering, a memory is dropped when a later memory sits in the same domain, both carry a recorded time, and their summaries share at least `supersedeOverlap` of the shorter summary's words — 0.6 by default. The share is measured over word sets, so word order and phrasing length do not defeat it. Ordering gained recency as its final tiebreak, after relevance, recorded outcome, snippet relevance, and provider score, so that two equally relevant memories present the later one first even when neither retires the other.

The comparison runs over memories already retrieved. It adds no provider call, no model call, and no request-path latency of its own; each summary's word set is computed once and reused across the ordering and every supersession pair, so the pass is linear in tokenization and quadratic only in set membership over the bounded candidate list.

Supersession governs the block alone. An earlier statement is removed from the turn's recalled context, never deleted and never withheld from explicit retrieval: `memory_search` and `memory_get` still return it, so the history stays reachable while the block states one value.

The referent is recorded when the correction arrives rather than inferred afterwards. `@aeven/memory-memos` tags the previous turn's trace `superseded:<replacement trace>` at capture, because a correction answers the exchange it follows; automatic recall then leaves that trace out on the same path that already leaves out a correction-tagged one. The write runs on the per-session capture queue after `turn/end`, so it adds nothing to the request path, and a correction whose preceding turn was never captured writes nothing.

## Alternatives considered

- A model call to detect contradiction. It cannot run on the request path: recall is bounded by `recallTimeoutMs` and already costs a median 87ms, and a model call would add seconds to every turn that recalls.
- Embedding both summaries and comparing vectors. The embedder already exists locally, but pushing it onto the request path costs an inference per recalled pair for a signal the word sets already supply.
- Resolving the referent by vocabulary alone, at capture or at recall. A correction names no target, and matching its words against older memories would retire whichever memory happened to share them; the previous turn of the same session is the exchange the correction actually answers.
- Deleting the superseded trace. It destroys the audit trail that says a value was once different, which the outcome evidence and the user's own corrections depend on.

## Consequences

The check is a heuristic over vocabulary. Two genuinely different memories phrased with the same words can be collapsed to the later one; the exposure is bounded because the check never crosses a domain, requires both recorded times, and leaves explicit search untouched, and `supersedeOverlap` is a validated config field for a deployment its default does not suit.

A correction and its subject share vocabulary by construction — they differ in the value — so the case the check exists for is the case it handles best.

Recall now depends on the provider reporting when a memory was recorded. A provider that omits `recordedAt` keeps both statements, which is the previous behaviour rather than a new failure.

A correction retires one trace: the previous turn's. A correction that reaches further back, or that arrives in a session whose preceding turn was never captured, leaves the earlier statement in automatic recall, where the render-time check can still retire it if the two summaries overlap. The two mechanisms therefore overlap in what they catch and neither is complete alone.

## Verification

An eight-case spec covers the correction shape, both statements kept when either time is unknown, both kept across a domain boundary, both kept at the strictest overlap, the later statement preferred when relevance ties, and exact-duplicate removal preserved. Six further cases cover the tag a correction writes, that a repeated replacement is held once while earlier ones stay readable, that a superseded memory is absent from automatic recall but present in an explicit lookup, and that a recalled memory carries its recorded time. Both specs pass, and `pnpm run typecheck` reports no errors.

Not measured: how often either mechanism fires in real recall, and whether retiring the earlier statement in the block changes what the agent does. The first needs a per-turn record the harness does not yet keep.
