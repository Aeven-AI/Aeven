# Agent Note: recall starts before the pre-step chain, and a later turn's two judgments run at once

Status: implemented

English | [中文](2026-11-11-recall-before-the-chain-and-judgments-at-once.zh.md)

## Problem

On the desktop, a turn's first model request started a median 4.2 s and up to 17 s after the turn began (110 turns measured on 2026-11-11), and nearly all of it was turn-start recall. Recall started only after every later `agent/pre-step` listener had finished. On a later personal turn, [recall of recent memories](2026-10-23-recall-what-the-person-is-living-through.md) ran a second relevance judgment after the first one, so that turn waited for two model round trips one after the other.

## Decision

- `@aeven/memory-context` starts recall and the profile read from the claimed input in a listener prepended to the `agent/pre-step` chain, so the work also overlaps the Host listeners that run before the recall listener, such as connector sign-in in `@aeven/host-account-integrations`, workspace sync, and the checkpoint flush. The recall listener keeps its place in the chain and takes the started work, so the messages it appends keep their order; a chain that ends before reaching it cancels the work. When the chain's decision carries the same request text, the turn uses that work. When the decision carries a different request or rejects the step, the early work is cancelled and recall runs for the decided request, as before.
- `MemosMemory` runs a later turn's judgment without the person's recent memories and the judgment with them at the same time. The judgment with them is used only when the first finds the person sharing and the second is not degraded, which is the rule the sequential version applied, so the recalled memories are the same and the turn waits for the slower call instead of both.
- A relevance judgment still unanswered after `relevanceHedgeMs` (2000 ms) is sent once more with the same prompt, and a request that fails or answers unusably before then is resent at once; the first usable answer wins and the other request is cancelled. Small JSON calls on the desktop's route measured a 1.6 s 95th percentile over 14 days, so the second request goes out for a few percent of judgments.
- The judgment gets at least `relevanceMinMs` (3500 ms, capped by `relevanceTimeoutMs`) even when retrieval used most of the recall budget, so a recall can finish up to that long after `recallTimeoutMs`. The `ctx.memory` recall request states this bound.
- A person-profile refresh, a long distillation call on the same route, starts after the owner's turn-start recalls settle instead of beside the judgment they wait for.
- Every judgment appends a `recall_judgment` row to the owner's MemOS `api_logs` through `MemoryCore.logApiCall`: candidate count, input size, retrieval time, window, outcome (`judged`, `unusable`, `failed`, `timeout`, `no-time`), and each request's start, duration, and status. The rows carry no memory text.
- On a hosted Host, the shared embedding worker takes a waiting query embedding before queued document batches.

## Alternatives considered

- **One judgment with the recent memories always among the candidates**: no extra model call, but a work turn would see personal history it never saw before, which changes what recall keeps.
- **A shorter judgment or recall budget**: faster, but a slow judgment would fall back to unjudged hits and lower recall quality.
- **Embedding priority and batching**: measured on 2026-11-11 at 15 ms for a turn's query and about 0.5 s behind a full document batch, so it would not shorten the wait on the desktop.

## Consequences

On 2026-11-16, 143 of 250 desktop recall turns delivered one or two memories with a median wait of 5.7 s, most at the 5 s recall deadline, while judged recalls finished in under 3.5 s: the pattern of the unjudged fallback after a judgment ran out of time. The second request and the minimum window aim those turns at a judged result; the `recall_judgment` rows measure whether they do and are the evidence for later budget changes. A recall can wait up to `relevanceMinMs` beyond its budget when retrieval was slow.

A later turn that has recent personal memories sends one more relevance judgment than before, a small Flash call billed to the account. Early recall work for a request the chain rewrites is cancelled, not delivered.
