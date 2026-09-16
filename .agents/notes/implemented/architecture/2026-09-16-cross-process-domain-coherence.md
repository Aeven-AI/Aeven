# Agent Note: Cross-process domain coherence

Status: implemented

## Problem

The storage-domain layer assumed one process owns `~/.dsh`. Running two harness instances against the same home — the shipped web app and a desktop build, or two dev servers — made session titles vanish from the session list and silently destroyed workspace grouping.

The cause is not the medium. The facility opens a domain by calling `unit.loadAll()` exactly once and building `Map`s; `KvTableImpl.get()` then serves every read from that Map. `put()` writes through the unit, then mutates the same Map. Each process therefore holds a private snapshot taken at open time, and two processes diverge on the first write by either one. Swapping the JSON backend for `storage-sqlite` does not address this: its `loadAll()` is also a bulk read into the same Maps, so WAL would make concurrent writes safe while leaving reads equally stale.

Two mechanisms turned that staleness into user-visible loss:

- **Titles read as absent.** `session_projcache` is `per-record`, and `parseRecord` treats a document whose `version` stamp is outside `[version, ...compatibleVersions]` as *absent* rather than as an error ([storage-json/src/format.ts](../../../../packages/storage/storage-json/src/format.ts)). A build at domain version 5 cannot read the version-7 records a newer build writes, and `ApiSessionList.summarizeCold` served cold rows from the cache alone, so a discarded row rendered as "Untitled session". The underlying `session/title` events stay intact in the session JSONL; only the derived read path lost them.
- **Workspace grouping was overwritten.** The `workspace` domain used the whole-unit layout, so one `workspace.json` held every workspace record plus the global `archivedSessionIds`, and each write republished the writing process's entire in-memory snapshot. Unlike titles, nothing could rebuild that.

The asymmetry worth naming: `session-persistence-jsonl` already solves multi-process correctly. It takes a kernel `flock(2)` per session directory that the OS releases even on process death, and publishes via `link()`+`unlink()` — chosen over `rename()` because link fails with `EEXIST` instead of clobbering. Conversation data was already multi-writer safe. Only the derived domain layer was not, because it was built as process-local cache and then made authoritative for what the UI displays.

## Decision

An open domain converges on the medium when another process writes it, and those changes reach consumers as ordinary `domain/changed` events.

The event is the carrier because its consumer chain already exists and already handles increments correctly: `WorkspaceFeed` subscribes to `domain/changed` and pushes ordered increments to connected clients ([workspace-controller/src/feed.ts](../../../../packages/api/workspace-controller/src/feed.ts)). A foreign change reaching that event drives the whole pipeline unmodified. `events.ts` had already named this as "the event source for cross-process change push (RPC frames) in a later phase"; this is that phase, with the filesystem rather than RPC as the transport.

### Ownership

Detection belongs to the backend, because only the backend knows its medium. `KvUnit` carries one optional member, `watchExternal(onExternal)` ([storage/src/backend.ts](../../../../packages/storage/storage/src/backend.ts)), alongside the existing optional `backupRecord`. It reports *locations* — `{ table, key }`, with `table: ''` and `key: ''` naming the global singleton — and never values: the medium is authoritative and the domain re-reads it. A backend that cannot observe foreign writes omits the member, and its domains keep their open-time snapshot, which is the behavior every caller had before.

`DomainImpl.applyExternal` is the consumer. The facility calls `observeExternal()` once after construction, and `runClose()` stops observation before the write-chain drain.

No separate coherence package exists. A capability seam is warranted when roles evolve independently; here detection is inseparable from the medium the backend already owns, so the optional `KvUnit` member is the whole contract and a standalone service would have added a hop without a second implementer.

### Detecting a foreign write

`ExternalWatcher` ([storage-json/src/external-watch.ts](../../../../packages/storage/storage-json/src/external-watch.ts)) owns one fact: the stat identity (`mtimeMs`, `size`, `ino`) of every document it has observed. It reports a location whenever that identity differs from what it recorded, so detection never depends on the content of a filesystem event.

It watches the backend root, the unit directory, and every table directory that exists. Watching the root is load-bearing rather than defensive: the unit directory and each table directory are created lazily by their first write, `fs.watch` cannot observe a directory that does not exist, and the backend root is the one level guaranteed to exist because the backend creates it at open. Without the root watcher a unit that had never been written stayed sweep-only for the life of the process. Each reconcile re-runs installation, so a directory created later picks up its own watcher on the pass that first sees it.

Self-writes are excluded by stamp, not by path bookkeeping: `writeDocument` records the resulting stat identity after each durable write, so the next reconcile finds nothing to report. A self-write racing a foreign write to the same document is reported, which is correct — the bytes on the medium are no longer the ones this process wrote.

### When the watch misses

`fs.watch` drops events: queue overflow, network mounts, platforms that deliver nothing. Treating "no event" as "no change" would reintroduce the same silent staleness in a new place, so the watch is an accelerator and never the authority.

Two properties hold that line. The reconcile pass restats the directory instead of trusting any event payload, so a missed event costs latency rather than a wrong value. And because reconciliation is idempotent and cheap, a periodic sweep runs the same pass — watch events for latency, the sweep as the floor. Where `fs.watch` is unavailable the unit runs sweep-only and converges more slowly rather than not at all.

The cadence (`debounceMs: 50`, `sweepIntervalMs: 5_000`) is a constant, not configuration. The debounce only coalesces one burst of filesystem events, and the sweep exists to bound the damage of a dropped event; neither is a deployment-varying choice, and a deployment wanting a different convergence bound changes how often it reads.

### Applying a foreign change

`applyExternal` runs as one job on the domain's existing write chain. That is what makes it safe: the chain is already the serialization point for every mutation, so an external apply cannot interleave with a local `put`, and last-write-wins between processes resolves at the medium exactly as before. Within the job each reported location is re-read from the medium, validated with the table's own schema, written into the Map, and only then emitted.

That order is mandatory. The package invariant asserts the emitted value is identical to what memory already holds ([storage-domain/src/invariant.ts](../../../../packages/storage/storage-domain/src/invariant.ts)), so emitting before the mutation would fail it.

External changes carry the same `DomainChanged` union as local ones, with no origin discriminant. A consumer that behaved differently for a foreign write would be reasoning about which process wrote a value, which is the split-brain this removes.

A record that fails schema validation, or whose version stamp this build does not accept, is logged and leaves the current value in place — the same judgment the open-time load applies, and the reason a foreign write cannot turn into corruption.

### Version gating

Cross-version reads stay one-way: the domain version is a compatibility promise, not a coordination mechanism. What changed is the consequence. A build that cannot read a newer record no longer presents that as absent data — `ApiSessionList` refolds a title-less row from its durable log, so a title the cache cannot serve is still displayed.

## Alternatives considered

**Re-validate on every read.** `get()` stats the backing document and re-reads when it changed. Simpler, and needs no watch. Rejected because `get()` is synchronous across the entire read surface and the session-list path calls it per row per listing; making it async or blocking on stat would either change every caller or put filesystem I/O in the list render path — the cost the cache-only list existed to avoid.

**SQLite backend with WAL.** Real concurrent-write safety and an obvious fit. Rejected as insufficient rather than wrong: it fixes writes while `loadAll()` leaves reads stale, so titles would still vanish. Its README states "cross-process coordination is out of scope" and it has no busy-retry. It remains a reasonable medium underneath this design, which is why detection lives behind an optional `KvUnit` member rather than assuming files.

It is also not a performance argument. Measured on a real home of 176 projcache records totalling 1.68 MiB: a full `loadAll()`-equivalent read and parse costs 42 ms, an atomic whole-record write costs 0.21 ms at the median 7 KiB record and 0.51 ms at the largest 106 KiB one, and the whole-unit `workspace.json` rewrite costs 0.21 ms. The fsync syscall dominates rather than serialization — a 15x size increase costs 2.4x time — and SQLite pays the same fsync per durable commit.

**A lock file making the second instance read-only.** Cheap and safe. Rejected because it makes running a desktop app beside the web app a degraded mode rather than a supported one.

**A broker process owning `~/.dsh`.** One writer by construction, no reconciliation. Rejected as disproportionate: it introduces a lifecycle, a wire protocol, and a broker-death failure mode larger than the problem, and it would still need the `domain/changed` path this uses.

**Polling stat on an interval.** Portable, no `fs.watch` quirks. Rejected as the primary mechanism on both latency and idle cost, and kept as the sweep that backs the watch.

## Consequences

Two harness processes sharing one home converge: a record written by one is visible to the other in roughly 95 ms on a real 157-record projcache, and the workspace global — the slot holding display order and `archivedSessionIds` — converges the same way. Running the web app and a desktop build against one `~/.dsh` is now a supported configuration.

What it cost: `domain/changed` fan-out is now load-bearing across processes, so listeners that were implicitly "our own writes only" see foreign ones. That is the intended semantic and no consumer should distinguish them, but it widens the event's blast radius. Every open domain on a watching backend also carries one interval timer and a few directory watchers.

What it does not buy: convergence is eventual, not transactional. Two processes writing the same record still resolve last-write-wins at the medium; they converge and notice, rather than serialize. A cross-process read-modify-write race can still lose an update, and anything needing true atomicity must take a lock in the manner of `SessionWriteLease`.

Whole-unit (`single`-layout) domains are unchanged: a foreign write there lands as a whole-document replacement. `workspace` moved to `per-record` in the same change, so the domain that motivated this is no longer one of them.

## Related

The cold-listing refold that makes a cache miss recover from the durable log, and the `workspace` layout move, landed with this note. `bootstrapLegacyUnit` gained global migration in the same change: it previously copied only table records, so adopting `per-record` on a unit whose global carried authoritative state would have dropped it.
