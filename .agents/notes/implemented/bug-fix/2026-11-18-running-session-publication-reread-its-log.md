# Agent Note: publishing a running session re-read its whole log

Status: implemented

English | [中文](2026-11-18-running-session-publication-reread-its-log.zh.md)

## Problem

A CPU profile of the hosted Host showed one account's nine turns spending 12.8 seconds of main-thread time decoding its own session log: 106 full reads of a 2.5 MB log in ten minutes, up to 1.15 seconds each. Account sync publishes a running session `liveMs` after each commit and asked session persistence for the events after its published position. The JSONL backend stores a sequential log with no suffix read, so every publication decompressed and parsed the whole log, and the cost grew with the conversation.

The same profile showed 2.3 seconds in `deepFreeze`: `Session.requestHeader()` froze the folded header again on every read that followed a new event, although the fold returns its already frozen input when the new events hold no `request/header`.

## Decision

- The session mirror keeps the events each commit hands it, up to `tailEvents` per session (2,000 by default), and publishes from them. It reads the stored log only when the kept events do not start at the published position: after a restart, after an overflow, or for a log another process wrote. A publication with nothing new, which only updates index metadata, reads nothing.
- `Session.requestHeader()` freezes the fold only when folding produced a new header.

## Alternatives considered

- **A suffix read in the JSONL backend.** Deferred: Zstandard frames carry no event index, so it needs a per-log position cache inside the durable-format code, and the mirror already receives the events it asks for.

## Consequences

The mirror holds references to unpublished events for the few hundred milliseconds between commit and publication; the session already holds the same objects. Other callers of `SessionPersistence.readFrom` on a JSONL log still read the whole log.
