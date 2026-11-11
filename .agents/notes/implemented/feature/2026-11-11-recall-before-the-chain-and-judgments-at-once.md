# Agent Note: recall starts before the pre-step chain, and a later turn's two judgments run at once

Status: implemented

English | [中文](2026-11-11-recall-before-the-chain-and-judgments-at-once.zh.md)

## Problem

On the desktop, a turn's first model request started a median 4.2 s and up to 17 s after the turn began (110 turns measured on 2026-11-11), and nearly all of it was turn-start recall. Recall started only after every later `agent/pre-step` listener had finished. On a later personal turn, [recall of recent memories](2026-10-23-recall-what-the-person-is-living-through.md) ran a second relevance judgment after the first one, so that turn waited for two model round trips one after the other.

## Decision

- `@aeven/memory-context` starts recall and the profile read from the claimed input before it calls `next()`. When the chain's decision carries the same request text, the turn uses that work. When the decision carries a different request or rejects the step, the early work is cancelled and recall runs for the decided request, as before.
- `MemosMemory` runs a later turn's judgment without the person's recent memories and the judgment with them at the same time. The judgment with them is used only when the first finds the person sharing and the second is not degraded, which is the rule the sequential version applied, so the recalled memories are the same and the turn waits for the slower call instead of both.

## Alternatives considered

- **One judgment with the recent memories always among the candidates**: no extra model call, but a work turn would see personal history it never saw before, which changes what recall keeps.
- **A shorter judgment or recall budget**: faster, but a slow judgment would fall back to unjudged hits and lower recall quality.
- **Embedding priority and batching**: measured on 2026-11-11 at 15 ms for a turn's query and about 0.5 s behind a full document batch, so it would not shorten the wait on the desktop.

## Consequences

A later turn that has recent personal memories sends one more relevance judgment than before, a small Flash call billed to the account. Early recall work for a request the chain rewrites is cancelled, not delivered.
