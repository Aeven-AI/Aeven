# Agent Note: an account's memory no longer costs minutes at every Host start

Status: implemented

English | [中文](2026-11-18-memory-restart-cost.zh.md)

## Problem

From 0.3.58 the desktop loads an account's memory at sign-in (`warmOnSignIn`). On an account with 45,781 traces in a 1.1 GB database, that load ran on the Host's main thread through full-table reads, the heap grew to about 6 GB, garbage collection took over, and the Host answered nothing for about ten minutes after every start; the desktop then refused to start a second Host. Two costs remained after the listing fix and the core workers of 2026-11-18: every start rebuilt the vector index from all rows, and every start listed the person memories before the profile block could be served.

## Decision

- **Saved vector index.** The vendored index saves each built column beside the database and restores it at the next start, then reads only the rows added since. An `AFTER UPDATE OF <column>` trigger counts in-place vector writes from every connection, memory sync's included, and a saved file whose count or highest row differs is rebuilt. On a copy of the account above, the first search of both columns after a start takes 103 ms instead of 698 ms.
- **Saved person listing.** `@aeven/memory-memos` writes each person-memory listing to `person-facts.json`; the first profile read after a start serves it while a new listing runs in the background. Later expired listings still wait, as before.
- **Delayed warm-up.** `warmDelayMs` starts the sign-in load after the window is served; Web and Desktop use ten seconds.

## Alternatives considered

- **Turn the sign-in load off.** Rejected: the first turn after a start then times out on recall, the problem the load solved.
- **Trim stored data (audit rows, old tool output and thinking).** Rejected by the owner: stored memory stays as captured.

## Consequences

Each account keeps one saved index file per vector column, about 70 MB per column at 45,000 traces. The database keeps growing with memory; its size no longer decides what a start costs.
