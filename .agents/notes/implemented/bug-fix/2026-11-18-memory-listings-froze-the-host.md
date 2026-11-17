# Agent Note: memory listings froze the Host before each turn

Status: implemented

English | [中文](2026-11-18-memory-listings-froze-the-host.zh.md)

## Problem

On Aeven Cloud, turns of an account with 45,685 traces waited 5–12 seconds before the model request, and the recall relevance judgment timed out although the model answered in about one second. A CPU profile of the hosted Host over nine turns showed the main thread busy for up to 4.6 seconds without a break in three trace listings, each of which read every trace row with both vector BLOBs, the tool-call JSON, and the thinking text:

- the learned-procedure list, a text query for `Learned procedure` re-read after every memory write;
- the check for a conversation that already marked today's date, a text query per marker word that listed and counted, two full reads each;
- the person-facts listing behind the profile block.

MemOS runs in the Host process on synchronous SQLite, so each read stopped every account's turn, and the judgment's timers fired late.

## Decision

Listings filter in SQL and read no vectors; their results are unchanged.

- `MemoryCore.listTraces` and `countTraces` take `userTextPrefix` and `fromMs`, applied in SQL by the traces repository, and every listing scan selects the vector BLOBs as NULL.
- `@aeven/memory-memos` reads learned procedures by `userTextPrefix`. `PROCEDURE_HEADER` already required that prefix, so the same procedures are returned; on the profiled account both queries return the same 40 traces, in 46 ms instead of about 2 seconds.
- `MemoryListRequest.since` bounds a listing by time. The marked-date check passes the last 24 hours, the only records it accepted.

## Alternatives considered

- **Filter the text query with SQL `LIKE`.** Rejected for the general query: SQLite folds case for ASCII only, while the JavaScript match lowercases Unicode, so results could differ.
- **Keep the procedure list across memory writes.** Not needed once the read takes milliseconds, and it would delay a new procedure.

## Consequences

A general text query from the memory manager or `tool-memory` still reads every trace, without vectors. Search, ranking, and capture still run on the Host's main thread, about 0.9 seconds per turn on the profiled account; moving MemOS into worker threads remains open.
