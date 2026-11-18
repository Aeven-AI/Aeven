# Agent Note: MemOS cores run on worker threads

Status: implemented

English | [中文](2026-11-18-memory-cores-on-worker-threads.zh.md)

## Problem

MemOS ran every account's core in the Host process on synchronous SQLite. Search, ranking, and capture for one account held the Host's single event loop, so every other account's turn waited, and a turn's own recall competed with its capture. After the listing fixes of 2026-11-18 a profiled turn still spent about 0.9 seconds of Host time in search and ranking, and the first search after a start loaded the account's vector index on that thread.

## Decision

`@aeven/memory-memos` runs the cores on `coreWorkers` worker threads; `0` keeps them in the Host process. The Web and Desktop compositions use one worker and the hosted composition eight.

- **Seam.** The Host keeps a stand-in for each account's `MemoryCore`. Its roughly twenty methods take and return plain data, so each call is one message to the worker that holds the account's core, database connection, and vector index. The runtime above it is unchanged.
- **Placement.** An account opens on the worker holding the fewest accounts and stays there. A worker that stops fails its calls in flight and releases its accounts, which open again on their next use.
- **Callbacks into the Host.** LLM requests go back to the Host's bridge. A call made inside a session route records the Host's async context (`AsyncLocalStorage.snapshot()`), the worker tags the continuations of that call with its id, and the bridge runs in the recorded context, so the route and the turn-judgment slot reach requests issued after the call returned. The newest `coreCallContexts` are kept. Hosted embedding requests go to the Host's embedding queue. The maintenance gate is asked synchronously: the worker waits on a shared cell for at most `coreGateTimeoutMs`, and no answer counts as a refusal.
- **Evidence.** `scripts/load.ts` runs one recall per account at once. With 40 accounts of 2,500 traces, eight workers answered 1,885 recalls per second with the calling thread held 13 ms at most; in-process cores answered 464 per second and held it 68 ms.

## Alternatives considered

- **One process per account, or a memory service.** Deferred until one machine is not enough; the message seam is the same.
- **A vector index library.** Not needed at the sizes seen: an in-memory scan of 45,000 vectors takes tens of milliseconds.
- **Running the whole provider in the worker.** Rejected: recall orchestration reads sessions, workspaces, and settings that live on the Host.

## Consequences

Each worker holds its accounts' vector indexes within MemOS's own 512 MB budget, so memory use grows with the worker count. Idle accounts are not closed. Memory sync still opens each database on the Host's thread, and session persistence and the agent loops remain on it; `@aeven/hosted-app` logs when that thread was held.
