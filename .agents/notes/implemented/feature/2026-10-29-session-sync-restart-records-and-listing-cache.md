# Agent Note: Session sync restarts, listing cache, and the running flag

Status: implemented

English | [中文](2026-10-29-session-sync-restart-records-and-listing-cache.zh.md)

## Problem

Every start of an account's sync rebuilt the same facts. `importAll` listed the device's sessions, then counted each log's events by reading it from offset 0, so a restart re-read every session log it holds. Listing a session read its header through a bounded first-line read on every pass. `SessionMirror.catalog()` asked the workspace registry where each session lives, one registry scan per session.

A device claimed over the local network also never released: `holdRunner(id, false)` returned before publishing when no lease holder existed, so the shared index entry kept `running: true`. Every other device of the account saw a turn running and refused to take the session over, which the person experiences as input refused with "agent busy" for a conversation nothing is running.

## Decision

Each device keeps a session record of its own in the account's sync store, under `session-sync/<id>`, that never syncs: the log revision whose committed events it last published, the stream position it imported up to, and one past the last stored `seq` counted at a given revision. `SessionMirror.next()` answers from that record while the log's revision is unchanged, so a restart reads only the logs that changed.

Listing caches each artifact by log path while that log and its replica marker keep the revision it was read at, and hands out a copy of the header, since callers own the header they receive. A header rewrite replaces the file, so a changed header always arrives with a changed revision. `SessionMirror.importAll` takes revisions from that listing.

`WorkspaceRegistry.sessionHomes()` names every filed session's workspace in one pass, and the catalog uses it instead of one `sessionHome` call per session. `PersistenceCoordinator.load` adopts the graph `loadStored` returns instead of cloning it, because that graph is fresh and unretained.

`holdRunner(id, false)` publishes before it releases regardless of a lease, and disposes the lease only when the device holds one. A device that claimed over the local network therefore clears the flag that told the account a turn runs.

## Alternatives considered

**Keep counting log events through `readFrom` on every start.** Rejected: it is the dominant startup cost for an account with history, and the count only changes when the log does.

**Sync the records between devices.** Rejected: they describe what one device read, not shared state; another device's cursor says nothing about this log.

**Cache headers without a revision key.** Rejected: a rewritten header line would never be seen again.

**Ask the writing device over the local network whether it is running.** Deferred: the local link carries live updates only, so this needs a request/response frame the transport does not have yet; clearing the flag on release fixes the stall without it.

## Consequences

- A restart publishes nothing for logs whose revision is unchanged and reads those logs' events not at all.
- A device that misses a live index update while the relay is unreachable still learns it when the relay returns; the local link carries live frames only.
- The record is device-local state that survives restarts inside the account store; deleting it costs one full publication or stream read and nothing else.
