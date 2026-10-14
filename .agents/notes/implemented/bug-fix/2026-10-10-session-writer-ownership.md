# Agent Note: Per-session writer ownership across Hosts

Status: implemented

English | [中文](2026-10-10-session-writer-ownership.zh.md)

## Problem

Web and Electron Hosts can share an account and persistence root while holding independent copies of one Session. Process-local sequence counters and preparation reservations cannot stop a second Host from treating the first Host's open turn as interrupted, appending recovery events, and resuming the same log. Both executions then append overlapping sequences.

## Decision

The JSONL backend claims an OS-owned writer lock for each Session identity through `PersistenceBackend.acquireWriter`. The coordinator acquires it before recovery commits, creation, deletion, live adoption, or append. It retains ownership through preparation and publication until the exact live Session's final flush drains. Unpublished rollback and load-only recovery release ownership; backend disposal drains writes before releasing remaining claims. POSIX uses nonblocking `flock`; Windows holds a file handle with sharing disabled. Persistent lock files are never unlinked, and process exit releases the kernel claim.

Readers remain independent of writer ownership. Separate Session identities can execute concurrently in different Hosts, including Hosts authenticated as the same user. A conflicting resume reports `session/agent-busy`. Electron stream frames preserve Host errors instead of terminating the byte stream with an opaque network error.

## Alternatives considered

**One writer for the whole home.** This prevents independent chats from running in separate Hosts and is broader than Session execution ownership.

**Only check the current log revision before appending.** Two Hosts can pass that check before either writes. It also permits recovery to close another Host's still-running turn. Ownership must cover recovery and execution, not just one batch.

**Discard conflicting records when reading.** Overlapping sequences can represent real, divergent user messages and tool outcomes. The reader continues to reject committed corruption; recovery preserves each continuation separately.

## Consequences

The lock coordinates participating JSONL Hosts without changing the Session log format or account ownership. A live Session remains owned until disposal; cross-Host delivery to that execution is not implemented by this change. Old running Hosts must restart to participate. TypeScript and build validation do not establish concurrent runtime behavior or Windows locking behavior; those checks remain unrun under the user's validation limit.
