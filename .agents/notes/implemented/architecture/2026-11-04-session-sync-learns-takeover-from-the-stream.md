# Agent Note: session-sync learns a takeover from the stream, and folds a batch that overwrites already-accepted events

Status: implemented

English | [中文](2026-11-04-session-sync-learns-takeover-from-the-stream.zh.md)

## Problem

The multi-device session-sync rewrite moved a session's writer from an `origin` field on the index entry to a lease plus a claim that travels in the stream's batches. Four paths did not follow the move, and each of them failed visibly:

- A device that claimed a session installed no stream subscription of its own, so a takeover over the local network — the only path that carries mid-turn when the relay is down — never reached it. The claiming device kept writing under a claim another device had already replaced, and the turn it appended was dropped by the receiving side.
- The local-network ingest refused a batch whose first event fell before the log's end, exactly the shape a device sends after republishing from a fold head that was older than its log. Batches that overlap accepted events are ordinary; only a batch that starts past the log's end is a wait for the relay.
- A seeded session's inherited prefix was applied batch by batch. Nothing was created until the prefix was complete, so the second batch of a multi-batch prefix read as a gap, reset the fold, and livelocked. The prefix has to commit in one append, as the persistence layer requires.
- An initialization-only suffix published whenever its session already had an index entry, so a draft holding nothing but `sandbox/mode` and `session/end-seed` reached the stream — the exact case the guard exists to keep local.

A fold that meets a hole in the stream also stayed silent, and a device whose claim another device superseded kept it until its next turn, so its log never became a copy.

## Decision

The claim is the only fact that decides who writes a session, and the fold is the only place that compares claims.

- `claim()` subscribes to the session's stream, because another device's claim reaches this one there and nowhere else.
- `ingestLan()` accepts a batch that starts inside the accepted log and appends from the log's end; a batch that starts past it waits for the relay.
- `fold()` accumulates events until the inherited prefix is complete and applies them as one append, recording the fold's position only when nothing is left buffered.
- `fold()` reports a batch that begins past the accepted head as `session <id> is missing events <head>–<last>`, instead of skipping it.
- `importAll()` folds a session this device claims but no longer runs, so a claim the accepted history superseded ends there rather than at the next turn.
- An initialization-only suffix stays local whether or not the session has an index entry.

## Alternatives considered

Keep `origin` on the index entry and release a session when another device's origin appears. Rejected: a claim is a fact of the stream, and the index cannot say which claim was accepted — a device that claims and writes nothing would release its peer with no history to settle the difference.

Have a claiming device publish a claim-only batch, so every device learns the claim without writing an event. Rejected: a batch with no events has nothing to fold, and it would need its own rule in the fold, which compares claims through the events they carry.

Refuse a batch that starts inside the accepted log. Rejected: a device republishing after a stale fold head sends exactly that batch, and refusing it drops a turn the other device can no longer obtain.

## Consequences

A device that loses a turn to another device learns it from the stream and marks its log a copy, instead of holding a live claim over a conversation it no longer writes.

Tests describe the new timing rather than the old one: a claim is invisible to other devices until the claiming device writes, input forwarded for a turn belongs to a device that holds both the claim and the running flag, and an offline device claims a session while its fold settles the difference later.
