# Agent Note: Desktop update layout and health-check speed

Status: implemented

English | [中文](2026-11-06-desktop-update-layout-and-health-check-speed.zh.md)

## Problem

Updating the installed Windows arm64 Desktop to 0.3.35-alpha took about 2 minutes 17 seconds from the application's launch to a serving Host. File timestamps under `~/.aeven` place the time as follows:

| Phase | Time |
| --- | --- |
| Seed hash, shard extraction (1,567 new files, 64 MB), and store merge | about 26 s |
| Windows [precomputed profile layout](2026-10-29-windows-precomputed-profile-layout.md) | 60 s |
| Staged health-check Host boot and stop | about 36 s |
| Serving Host boot | 15 s |

A layout of 22,914 files reuses 20,131 store objects (574 MB) that the extraction left in place. `installSeedProfileLayout` read and SHA-512-checked each reused object just before hard-linking it, in fixed batches of 64. Timed with the bundled Node.js against the installed seed and store, that order took 56.2 s, while hashing every object alone took 5.0 s and linking every file alone 16.1 s.

The staged health-check Host ran with `NODE_COMPILE_CACHE`. Node.js keys cached code by module path, and each staging profile has a fresh path, so that Host compiled everything and spent its exit writing about 2,076 entries (16 MB) that no later launch reads. Against an empty home, a Host whose cache is cold stops in 7.3-8.4 s, and one without the cache in 2.1-2.7 s, with the same boot time. The installed home held 6,310 Node.js 24 cache entries, three runs' worth.

`verifySeedIntegrity` read each seed file whole and hashed it in one call, one file at a time; hashing a 40 MB shard held Electron's main thread for up to 1.2 s.

## Decision

- `installSeedProfileLayout` checks every reused store object first and links every file afterwards. A failed check therefore links no file. Both steps, and the directory creation, run through a pool of 64 calls that starts the next item as soon as one finishes; no item starts after a failure, and every started call settles before the first failure is thrown.
- The shell starts the staged health-check Host without `NODE_COMPILE_CACHE`. The serving Host keeps the cache.
- `verifySeedIntegrity` streams four files at a time through their SHA-256 hashes in 1 MiB chunks.

## Alternatives considered

**Trust a reused store object by its path and size.** The layout's digest check is the only content check a Windows profile receives, since no pnpm installation runs; removing it would let a corrupted store object into the profile.

**Validate the update by booting the serving Host from the activated profile.** That saves the staged boot, but undoing a failed activation renames the profile back, and on Windows a failed Host's descendants can hold that directory ([swap locks](2026-10-27-desktop-windows-profile-swap-locks.md)).

**Delete the previous rollback profile after the Host starts.** `activate` still removes it synchronously, about 3-4 s for a 23,000-file tree, while no Host serves. Deferring it needs a staging sweep that coordinates with the package transaction lock.

## Consequences

Against the installed 0.3.35-alpha seed and store, the update layout takes 12.5-13.9 s instead of 56.2 s, a first-installation layout 8.7 s instead of 16.1 s, and seed verification 2.3-3.1 s instead of 3.7 s, holding the main thread for at most about 30 ms at a time. An update spends about 6 s less stopping the health-check Host and adds nothing to the compile cache. The serving Host's own boot on a home with many sessions is unchanged.

`apps/desktop/tests/seed-profile.spec.ts` proves that a corrupt reused object rejects the layout before any link. The timings come from scripts that ran the shipped functions with the bundled Node.js against the installed application's seed and store; no complete update of an installed build has run with this change.
