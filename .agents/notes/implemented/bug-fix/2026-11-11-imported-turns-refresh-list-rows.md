# Agent Note: Imported turns refresh a Session's list row

Status: implemented

English | [中文](2026-11-11-imported-turns-refresh-list-rows.zh.md)

## Problem

On 2026-11-11, a conversation started on chat.aeven.io and answered by the user's desktop disappeared from the Aeven Web sidebar after a reload. Opening it showed the row as New Session and drew the New Session hero under 778 events of conversation. The Host's `session/list` returned the Session as `blank: true` with projections at `asOfSeq: 2`, while its stored log reached seq 777.

Aeven Web creates a new web chat, writes its projection cache row at creation (initialization events only, so `blank: true`), and forwards the input to a desktop. Every turn then reaches Aeven Web as imported events, appended to the stored log without a live Session, so no write-behind checkpoint ran. `summaryForStored` folded the imported log through `hydratePrepared`, which writes no cache row, so only clients connected at import time saw the corrected row; every later `list()` served the creation-time row. The title refold in `list()` skips blank rows, so nothing repaired it. A chat started on a desktop was unaffected, because Aeven Web held no cache row for it and the title refold built one from the complete log.

## Decision

`summaryForStored` folds a cold Session's observed log through `sessionProjectionCache.coldSnapshot`, which writes the refreshed row back, so each import pass leaves the cache current. `list()` also refolds blank rows whose account catalog entry is ahead of the cached row, within the existing 20-row refold budget, and takes `blank` and `updatedAt` from the refolded list metadata. A row that is still blank after refolding stays hidden, so genuinely empty chats stay out of the sidebar.

## Alternatives considered

Deriving the hero and sidebar visibility from the opened conversation's events would hide the symptom in one client while the Host kept serving a wrong list. Writing the cache row from the session-sync mirror would put projection knowledge into the sync layer, which only appends events.

## Consequences

Rows that went stale before this change repair on the first listing that sees them. Imported Sessions' cache rows now also follow their logs for title, turn count, and activity, not only blankness. A blank row whose catalog is ahead of a log not yet imported is refolded on each listing until the import lands; its log holds only initialization events, so the refold is small.

## Verification

Typecheck of `@aeven/api-session-controller` and its build pass. On chat.aeven.io before deployment, all 1,211 listed rows were checked: 3 were blank, and only the affected Session's log (seq 777) was ahead of its cached row (seq 2); the other two logs end at their cached rows.
