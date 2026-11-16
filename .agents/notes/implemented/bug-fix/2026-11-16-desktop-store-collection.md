# Agent Note: the desktop pnpm store keeps only what installed profiles reference

Status: implemented

English | [中文](2026-11-16-desktop-store-collection.zh.md)

## Problem

Every desktop release merges its seed's pnpm store into the persistent store at `$AVN_HOME/desktop/pnpm/store`, and nothing ever removed a package from it. On the owner's Mac on 2026-11-16 the store held 11 GB: 11,217 index rows, 10,285 of them first-party `file:desktop-packages/…` tarballs of past releases, while the active and rollback profiles referenced 1,269 rows and 0.67 GB. Every installation grows by roughly one release's package set per update.

## Decision

After `applyRelease` activates a profile, and while it still holds the package transaction lock, `collectDesktopStore` (`apps/desktop/src/store-collect.ts`) removes every store package whose integrity no `pnpm-lock.yaml` of the active, rollback, or prepared profile names. It deletes the index rows in one SQLite transaction, then the content objects that no remaining row's package files or build side effects reference, then vacuums the index. Rows go before objects, so an interruption leaves unreferenced objects for the next collection and never a row whose files are gone. An existing profile without a lockfile makes the collection change nothing; an index key without the `<integrity>\t<id>` shape is kept; a store entry outside pnpm's layout aborts before any change; and a failure is logged without failing the activation. The pnpm index reader moved from `apps/desktop/scripts/` to `apps/desktop/src/pnpm-store-index.ts`, shared by the seed build and the collection.

Run on an APFS clone of the owner's store, the collection removed 9,948 rows and 18,112 objects, 10.0 GiB, in 1.7 s, leaving 750 MB; `pnpm install --offline --frozen-lockfile` of the active profile then completed from the collected store with 921 packages reused and none downloaded.

## Alternatives considered

**`pnpm store prune`** — pnpm 11.7 deletes every content object with one hard link. On APFS pnpm installs profiles by cloning, so all 4,000 sampled objects had one link: a prune would empty the store, including the plugin packages that the next release adds to its profile with `pnpm add --offline`.

**Installing profiles by hard link so that `store prune` works** — changes how every profile is materialized: a package whose build script edits its own files would edit the shared store object, a risk APFS clones avoid.

**Collecting in a separate locked task after launch** — keeps collection off the activation path, but the package lock does not wait: a plugin install or a background release preparation during the collection would fail with "another package transaction is active". Deleting objects outside the lock is not safe either, because a concurrent install can reuse an object between the index commit and its deletion.

## Consequences

Collection runs only on launches that activate a release, and adds about two seconds there; installations shrink at their next update. Packages that only an older, no longer installed profile used must be fetched again if a plugin ever needs them, and a rollback after collection still works, because the rollback profile's lockfile is part of the kept set and its files are already materialized. The local-tarball integrity directories (`file+desktop-packages+…`, 37 MB on the owner's Mac) are not collected.
