# Agent Note: One MemOS database per account

Status: implemented

English | [中文](2026-10-07-per-account-memory-databases.zh.md)

## Problem

`@aeven/memory-memos` ran one MemOS core over one database under `memory/data/memos.db`, and separated accounts only by MemOS profile. Every read passed through MemOS's visibility filter, which also admits rows with no owner, rows owned by `unknown`, and rows shared as `public` or `hub`, so isolation held only while no row ever reached one of those states. Deleting or exporting one person's memory meant filtering a shared file, and the MemOS Viewer served that whole file without sign-in.

## Decision

Each account has its own MemOS core over its own database at `accounts/<sha256 of the account id>/memory/data/memos.db`, the same per-account subtree that `@aeven/host-account-integrations` uses for connectors and skills; `@aeven/home-paths` exports `accountDirectoryName` and `accountHomePath` for it. `OwnerCores` ([`src/cores.ts`](../../../../packages/memory/memory-memos/src/cores.ts)) opens a core on the account's first memory operation, shares one open between concurrent first uses, forgets a failed open, and shuts every opened core down with the provider. Every `MemosMemory` operation resolves the core of its scope's owner; rows still carry the `user-<owner>` profile, and edits and deletes still check it. The provider's `home` keeps the `config.yaml` all cores share, and its new `accounts` field names the per-account root; each account's MemOS paths are built from that root rather than through `resolveHome`, whose `MEMOS_HOME` override would point every account at one file.

The embedding model is a module-level singleton in MemOS, so every core shares one loaded copy. Each open core adds its own SQLite connection, an embedding cache of at most 20,000 vectors, and three background timers.

At startup, `splitSharedMemory` ([`src/migrate.ts`](../../../../packages/memory/memory-memos/src/migrate.ts)) moves the shared database of earlier builds: for each `user-*` profile it copies the file with `VACUUM INTO`, deletes every row of other profiles and the link and retry rows they leave orphaned, optimizes the FTS5 indexes, vacuums, and renames the copy into the account's location. When every account moved, the shared file becomes `memos.db.split`; an account that already has a database keeps it, and a failure leaves the shared file for the next start. The split is deleted at the first tagged release.

The MemOS Viewer option is removed: one Viewer serves one core, and accounts reach their memory through the memory manager.

## Alternatives considered

**One Aeven home per account.** It isolates every kind of state, but two Hosts on one home cannot coordinate, and the same person on two devices would get two histories ([per-account isolation](2026-09-30-per-account-isolation-on-a-shared-host.md)).

**Keep one database and tighten MemOS's visibility filter.** It would need a growing modification to the vendored core, and the separation would still be one `WHERE` clause per query.

**Leave the shared database and start accounts empty.** Every existing user would lose their memory at upgrade.

## Consequences

An account's memory is one directory that can be deleted or exported, and another account's rows are not in the file its core opens. The first memory operation of an account after a Host start pays the core's open inside its recall deadline. Rows of profiles that are no account stay only in `memos.db.split`. The vendored MemOS `server/` tree and `viewer/dist/` have no consumer.
