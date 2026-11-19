# Agent Note: Host boot shares one session listing, and the session list answers in two requests

Status: implemented

English | [中文](2026-11-19-host-boot-shares-one-session-listing.zh.md)

## Problem

A profile of the desktop Host on a home with 1,339 sessions and eight signed-in accounts showed that the Host reported ready about 2.57 s after spawn (dev build, median of warm runs), and that the last plugin to settle was the workspace registry, about one second after nearly all others. The causes:

- Nine callers listed every stored session at the same time: one session-sync mirror per account and the workspace registry. Each ran its own `readdir` and `stat` pass over every session directory.
- `indexHeaders` resolved each session's working directory separately: 798 sessions in 13 distinct directories cost about 1,600 sequential file calls.
- The workspace registry started its listing only after its storage domain had opened, although the listing does not depend on the domain.
- `sessionHome`, `placeSession`, and `fileSession` found a session's workspace by scanning every workspace's full membership.
- `session/list` returned every projection hint for every row, a 2 MB reply, before the sidebar could draw a title.

## Decision

- `session-persistence-jsonl` shares a listing between concurrent callers. A caller that arrives while a listing runs waits for one trailing listing that starts after the running one ends, so it never receives a result older than its own call. Each caller gets its own header copies.
- `indexHeaders` resolves each distinct working directory once per pass.
- The workspace registry starts the listing before opening its domain and reads it where it previously called `list()`.
- `WorkspaceEntity.holds(id)` answers membership for one session, and the registry finds a session's workspace through it.
- `SessionListRequest.projections` names the projection keys a caller wants; each row then carries those keys and `sessionListMetadata`. The Web client draws its rows from a request for `title` and `schedule` (465 KB) and reads the complete hints with a second, unfiltered request.
- `SyncVault.documentId` memoises derived ids per vault key.

Measured Host time-to-ready on the same home: 2.57 s → 2.33 s (shared listing) → 2.14 s (per-directory resolution) → 2.04 s (early listing). The document-id memo changed nothing measurable at boot, because most names are distinct on the first pass. The packaged build was not re-measured.

## Alternatives considered

- **Join the listing already in flight.** Rejected for now: a caller could receive a result that predates its own write, and ruling that out needs a write epoch across about 20 write paths.
- **Bundle the Host into fewer files.** Rejected: the measured gain was 0.3–0.4 s for a packaging change that touches every plugin's resolution.
- **A larger libuv thread pool or young generation.** Measured, no effect: the boot is bound by the main thread.

## Consequences

An initialized registry with no workspace starts a listing it never reads. A chat opened between the two list requests gets its model and permission hints from its own history snapshot instead of from the list. Remaining boot costs, in measured order: plugin imports (about 0.9 s), synchronous sync-document attachment for every stored account (about 0.3 s), client module graph recomposition (about 0.19 s), projection cache validation (about 0.15 s), and speech model hashing (about 0.1 s).
