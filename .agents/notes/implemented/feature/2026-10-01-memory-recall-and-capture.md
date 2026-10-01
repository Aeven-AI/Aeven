# Agent Note: Recall reliability and capture at one-shot exit

Status: implemented

English | [中文](2026-10-01-memory-recall-and-capture.zh.md)

## Problem

Three defects let a turn run with less memory than the system appeared to deliver, and none of them was visible from the turn itself.

MemOS reads a long identifier in a query as a hard eligibility filter and keeps only candidates containing it verbatim. A turn-start query is a topic query, so one identifier-shaped token in the user's message — a session id, a commit hash, or an ordinary hyphenated compound such as `recalled-context` — dropped every candidate and returned nothing. Across the 45 turn-start searches MemOS had logged, **7 carried an identifier, all 7 lost candidates, and 5 returned nothing at all**, while all 38 without one returned 8–20 hits.

A turn that received no memory looked exactly like a turn that never ran a recall: the outcome reached only a `logger.debug` line, and the running Host's stdout log was empty.

A one-shot driver exits as soon as `session/settle` resolves, and `memory-context` did not subscribe to it, so the captures a headless turn queued were abandoned at process exit. A benchmark run measured `traces 0→0`: the teaching session finished and nothing was stored.

## Decision

`@aeven/memory-memos` runs the turn-start query as written, and when it yields no visible hit and the query holds tokens the core confirms exactly, retries once inside the same deadline with those tokens removed. `src/query.ts` mirrors the core's predicate so ordinary long words survive the retry. Explicit searches keep the identifier, because there an identifier is the point.

`@aeven/memory-context` appends one logged `notice` line when a turn-star recall delivers no block, naming which happened: the recall timed out, found nothing, or failed. The turn therefore records that it ran without memory instead of looking normal.

`@aeven/memory-context` also drains the session's queued captures at `session/settle`, which is the checkpoint a one-shot driver awaits before it exits. The provider's close runs after everything it already accepted, and a live session never reaches that checkpoint.

## Alternatives considered

- Changing the identifier rule in MemOS core. The rule is upstream and correct for an identifier lookup; the deployment owns its query, not the engine.
- Always removing identifiers from turn-start queries. A stored trace can contain the identifier the user pasted, so the precise pass is tried first and the topic retry only rescues the empty result.
- Reporting an empty recall only through the logger. The logger is not the turn's record, and an empty recall and a failed recall are then indistinguishable from a turn that never recalled.
- Draining captures on `session/disposed`. Disposal runs on a path a one-shot driver does not reach before exiting, which is why the queue was lost.

## Consequences

A turn-start recall now costs one extra provider call only when the query carries an identifier and the precise pass returns nothing; the retry shares the original deadline, so `recallTimeoutMs` still bounds the turn.

A turn with no memory carries one notice line, about 100 characters, and the model can tell that it is answering without earlier context. Abilities that are not measured remain unmeasured: the notice reports delivery, not compliance.

`session/settle` is currently reached only by the headless driver, so the drain is inert in the GUI, where `session/disposed` already closes sessions.

## Verification

TypeScript and the full build pass. Against the real memory database, using the exact query MemOS logged at 11:40:44 and a fresh identifier-bearing query: the query as written returned 0 hits, the same query with identifier tokens removed returned 5, and `MemosMemory.recall` over the original query returned 5 with `timedOut=false`. On the rebuilt Host, a GUI turn carrying `b1a6bc0e477c43649bf966…` received an 828-character recalled block where the pre-fix build received none.

The benchmark added in the same change measured the capture defect directly: before the `session/settle` drain, a teaching run reported `traces 0→0` and the probe abstained; after it, `traces 0→1` and the probe returned the taught value.

Two claims are deliberately not made. Recall delivery is established; recall benefit is not, and one live proof turn shows the block delivered while the agent spent the turn on unrelated tool calls. `@aeven/memory-memos` mirrors an upstream predicate that can change without this package: a core upgrade that alters identifier extraction silently ends the retry's usefulness, and nothing currently fails when that happens.
