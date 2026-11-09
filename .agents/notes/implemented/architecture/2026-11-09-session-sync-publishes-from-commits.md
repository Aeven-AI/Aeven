# Agent Note: Session sync publishes from commits and reads one session at a time

Status: implemented

English | [中文](2026-11-09-session-sync-publishes-from-commits.zh.md)

## Problem

On hosted Web, one Host process serves every account, and every account's sessions share one JSONL session root. `avn-session-sync` ran one mirror per account, and each mirror called `listSnapshots()` every `publishMs` (3 s) to find sessions with unpublished events. A listing read every session of every account: per session a failed `open` of the other encoding's log, which builds an `Error` with a stack trace, a stat of the log, a stat of the replica marker, and the same two stats again in `listSnapshots`. With 8 accounts and 1,200 stored sessions, pink measured about 16,000 `statx` calls a second and 66–70% of one core on the Host's event loop while no request and no relay traffic was in flight, so every page, API call, and stream on chat.aeven.io waited behind the scan. The cost grew with accounts times all stored sessions. `fold`, `releaseLocal`, `claim`, and `fetch` also called `list()` to check one session, and each remote change to an account's index started an import pass that listed every session again.

## Decision

Publication follows commits. A session this process writes already publishes from `session-persistence/append` after `liveMs`. A publication that fails, a session committed before its mirror started, and a session moved to another workspace here (`workspace/changed`, forwarded by `SessionSync`) are marked; a pass after `publishMs` reads only the marked sessions. The scan of every stored session runs when a mirror starts, when its account reconnects, and every `scanMs`, which finds logs another process wrote into a shared session root. `scanMs` defaults to 30 s; `0` keeps only start and reconnect; the hosted patch sets 300 s, because only the Host writes its session root. A scan that cannot read the stored sessions repeats after `publishMs`.

Imports follow the index. The `sessions/index` observer passes the keys another device changed, and the import pass reads only those sessions. Mirror start, reconnect, late filing, and a newly provided workspace registry run a full pass.

`SessionPersistence` gains `snapshot(id)`: one session's header and the revision `listSnapshots` reports for it. The Service Definition implements it with `listSnapshots`; the JSONL backend reads the directory the last listing or lookup found the session in and falls back to its project-directory search. `avn-session-sync`, `avn-message-feedback`, `avn-subagent` continuation, `avn-acp` resume, and the `avn-agent-loop` resume fallback use it instead of searching a listing.

The JSONL listing reads each session directory once, which tells which of the log, the other encoding's log, and `replica.json` exist, so an absent file costs no failed call; it stats the replica marker only when it exists, and `listSnapshots` reuses the revision the listing read instead of statting both files again. Full listings that the mirrors of different accounts request while one is in flight share it. An import fold's progress check compares the folded session's own download state instead of recounting every session twice.

## Alternatives considered

Raising `publishMs` alone was rejected: it cuts the cost by the same factor it delays publication, it keeps the cost proportional to accounts times sessions, and `publishMs` also paces outbox checks during history publication. An in-memory index in the JSONL backend that serves listings without I/O was rejected because other Hosts, such as an ACP or headless process beside the desktop Host, may write the same root, and appends change no directory timestamp a watcher could use cheaply. Listings scoped to one owner would change the `listSnapshots` signature for one Consumer, while commit-driven publication removes the periodic listing. Joining an in-flight listing inside the backend was rejected because `listSnapshots` callers may require a listing that starts after their own write; the mirrors can join because a commit after the listing began reaches them as an event.

## Consequences

On a Host whose sessions this process writes, steady state reads no session directory for sync; scan cost is one directory read and one or two stats per stored session, once per `scanMs`, shared across accounts. A session another process writes publishes within `scanMs` instead of `publishMs`. A session that no workspace holds here any more publishes its workspace removal at the next full scan rather than within `publishMs`. A `snapshot(id)` for a session the backend never listed searches every project directory, as `findLog` does. The session-sync test double gains `snapshot`, and its tuning names `scanMs`.
