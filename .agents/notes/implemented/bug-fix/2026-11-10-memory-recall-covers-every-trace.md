# Agent Note: Semantic memory recall covers every trace

Status: implemented

English | [中文](2026-11-10-memory-recall-covers-every-trace.zh.md)

## Problem

Turn-start recall finds memories through vector channels over `traces.vec_summary` and `traces.vec_action` (`tier2-trace.ts` in the vendored MemOS core). `traces.searchByVector` ran `scanAndTopK`, whose default `LIMIT 5000` has no `ORDER BY`, so semantic recall scored whichever 5,000 traces SQLite returned first. In the largest hosted account on 2026-11-10 that was 5,000 of 41,901 traces, from 2026-10-14 to 2026-11-04: the 5,615 newest traces and everything older than that window reached recall only through keyword search. Long-term recall is the product's main promise, and it silently degraded as an account grew.

Raising the cap alone would read and decode every vector BLOB on each recall: about 650 ms per column on that account, because the vectors sit inside 6.7 KB rows. A narrow side table (448 ms) or a covering index (626 ms) barely helped, since decoding the 64 MB of vectors dominates.

## Decision

Uncapped trace vector searches go through an in-memory cosine index (`vendor/memos-local-plugin/src/core/storage/vector-index.ts`), one per database, table, and vector column. It holds every non-empty vector in one `Float32Array`, scores the whole column per search, takes the best candidates from a bounded heap, and runs the caller's SQL filter on them, widening until `k` rows pass — so results are the exact top-K among the rows the filter admits. It stays current by reading rows past its highest rowid and rechecking rows whose vector was NULL on each search, and rebuilds when its highest rowid holds another row, after `traces.updateVector`, or when another connection, such as memory sync, committed and the build is ten minutes old. All indexes together stay within 512 MiB, dropping the least recently used.

The traces keep their vectors; the index is derived memory, so the database file, its schema, and the rows memory sync exchanges are unchanged, and older builds and devices read and sync the same data. The modification is logged as entry 35 in `vendor/README.md`.

## Alternatives considered

Ordering the capped scan by recency would keep new memories but drop old ones, which the long-term recall promise rules out.

A narrow vector table or a covering index changes the schema an older build opens and still costs 450–630 ms per column.

An approximate nearest-neighbour library (HNSW) adds a native dependency and approximate results; exact brute force over a contiguous array is fast enough at today's sizes.

## Consequences

Semantic recall reaches every trace of an account. The first recall after a Host start builds the index (about 0.7 s on the largest account); later recalls cost a delta read and the scoring. A trace vector rewritten in place by another connection is searched with its old vector until the next rebuild, at most ten minutes later. `policies`, `skills`, and `world_model` keep the capped scan: they stay far below 5,000 rows and rewrite vectors through many update paths.

## Verification

A script over 50,000 random 384-dimension rows matched an exact full scan's top 20 on every query, with and without a filter, including a filter that admits 100 rows; it found a new row, a vector that arrived after its row, a rewritten vector, and dropped a deleted row; a search took about 18 ms against 150–200 ms for the exact scan. On a copy of the largest hosted account, five sampled queries returned the same top 20 as an exact scan of all 41,901 traces, in 50–75 ms against 615–655 ms. The memory-memos specs pass (68).
