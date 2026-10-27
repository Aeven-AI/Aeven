# Agent Note: Desktop release install speed and start screen

Status: implemented

English | [中文](2026-10-27-desktop-release-install-speed.zh.md)

## Problem

Launching the Windows 0.3.18-alpha installer over a 0.3.15-alpha profile kept the start screen up for about four minutes, and it read "Installing update" throughout, including on a home with no profile at all. Timestamps and a timing of each phase with the bundled Node.js on the reporting machine (Windows on arm64, 19,612 store files in 620 MB of shards) showed:

| Phase | Time |
| --- | --- |
| Hash every seed file (`verifySeedIntegrity`), on every launch | 6.7 s |
| Hash the 311 local tarballs of the seed and of the profile (`verifyDesktopCorePackageSet`), on every launch, synchronously on the main process | 1.5 s |
| List and validate the shards | 1.7 s |
| Extract every shard into staging | 75 s |
| Copy the extraction into the persistent store | about 75 s |
| `pnpm install --offline` into a fresh staging profile | about 60 s |
| Health check and swap | about 7 s |

On Windows the start screen also showed no menu strip: the preload asks the shell for the menu labels on every page, and the shell registered that handler only after startup finished.

The store already held almost every file: a pnpm content-addressed path names its bytes' SHA-512, and the macOS seed writes each re-signed body at its new digest path, so a file at the same path holds the same bytes. The unpack step still wrote all 620 MB twice.

## Decision

- `extractPnpmStoreArchives` takes the persistent store and leaves out every entry the store already holds at the same path and size; the size comparison replaces a file an interrupted write truncated. Index databases are always extracted, because they are merged, not content-addressed.
- `mergePnpmStore` moves the extraction into the store by rename instead of copying it. A directory the store lacks moves whole unless it holds an index; a file replaces the store's file at the same path. Every rename goes through `renameRetryingWindowsLocks` (now in `rename-retry.ts`), since Windows scanners hold freshly written files. The staging directory and the store are both under `$AVN_HOME/desktop`, so the rename stays on one volume.
- `applyRelease` hashes the seed and verifies the seed's package set only after the fast path finds the profile out of date, and the fast path no longer hashes the profile's tarballs. Verification guards seed content entering writable state, and the fast path writes none; a current profile runs from its `node_modules` and nothing reads its tarballs again, since staging copies them from the seed. A launch with a current profile reads the seed's package-set descriptor and hashes nothing.
- The start screen names each step and whether it is a first installation: "Setting up Aeven: …" while no active profile exists, "Updating Aeven: …" otherwise, for unpacking packages, installing packages, and the health check.
- The caption-strip IPC handlers register before the start screen loads, so the Windows and Linux menu strip appears on the start screen.

Against the reporting machine's seed and store, the unpack step of an upgrade took 13.8 s and wrote one file. A first installation still extracts every file once, but no longer copies them a second time.

## Alternatives considered

**Extract straight into the persistent store.** An interrupted extraction would leave truncated files at content-addressed paths that later launches trust. Extracting into staging and renaming keeps every file the store receives complete.

**Cache a successful seed verification.** A stamp keyed by file sizes and times would still need its own trust rules; skipping verification on the path that writes nothing needs none.

**Shorten `pnpm install`.** It links about 22,000 files into a new staging `node_modules` and is now the largest remaining cost. Reusing the active profile's unchanged packages would change the staging transaction, and is left for a separate change.

## Consequences

The store merge now consumes its extraction, so the extraction directory holds only what failed to move when a rename gives up. A store file that matches a seed entry's path and size is trusted without comparing bytes; pnpm's own store integrity check still covers it at install time.
