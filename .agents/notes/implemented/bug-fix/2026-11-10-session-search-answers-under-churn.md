# Agent Note: Session search answers while other sessions keep changing

Status: implemented

English | [中文](2026-11-10-session-search-answers-under-churn.zh.md)

## Problem

Every search, and the background refresh after start, runs `_observeStable` in `packages/session-query/session-query-sqlite/src/index.ts`. It lists the persisted sessions, indexes the changed ones, lists them again, and requires both listings and the live-session set to match. After one retry it threw `SESSION_QUERY_PERSISTENCE_FAILED`. The hosted Host indexes the sessions of every account, so any account's write between the two listings counts as churn. The startup refresh, which indexes every session changed since the last run, failed after each restart of pink (`background index refresh failed`, four times between 2026-11-08 and 2026-11-10), and the same rule can fail a user's search on a busy Host.

## Decision

Churn in the persisted snapshots or the live-session set still earns one retry, and on the last attempt the search answers from that attempt instead of failing. Rows are keyed by revision, so that observation is correct as of its first listing; a session that changed after it is indexed by the next reconcile. A change of the persistence binding itself still retries and then fails, because an observation from a replaced store is not a valid answer.

The derived index also runs with `synchronous = NORMAL` and `temp_store = MEMORY`. Each indexed session commits in its own transaction, and `FULL` synced once per session during the startup refresh, which lengthened the window in which churn occurs. The index rebuilds from the session logs, so a commit lost to a power failure is recomputed.

## Alternatives considered

More retries would only lower the odds: a Host serving many accounts writes continuously, and every retry repeats the full listing.

Scoping the listing to the searching account would shrink the window but changes the persistence query surface; the revision-keyed rows already make a best-effort observation correct.

## Consequences

A search can miss a session written while it ran, until the next search. The background refresh stops failing after restarts.

## Verification

`packages/session-query/session-query-sqlite/tests/sqlite.spec.ts` pins that continuous snapshot churn returns the session from the last attempt after four listings; the session-query specs pass (262). On pink, the search index held 1,233 persisted sessions in 426k documents, and FTS5 MATCH queries took 2–4 ms on a copy.
