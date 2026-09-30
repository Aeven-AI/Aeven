# Agent Note: The media-store sweep reaped temporaries a live write still owned

Status: implemented

English | [中文](2026-09-22-media-store-sweep-reaped-live-temporaries.zh.md)

## Problem

`packages/llm/subscription-auth/tests/media-store.spec.ts`'s `never publishes two artifacts under one id when two stores share a root` failed a full coverage run with `expected Error: ENOENT … to match object { code: 'INVALID_ID' }`. It passed alone and failed only under full-suite contention.

The assertion says the losing `save()` must reject because it cannot allocate an unused artifact id. `ENOENT` says something else happened, and the reproduction names it exactly: `link '…/objects/89/.tmp-849d1129bc23bbaa' -> '…/objects/89/89221da…'`.

`writeExclusiveFile` publishes through a `.tmp-<random>` file: it writes the payload, links that name onto the final name, then unlinks the temporary. The temporary therefore belongs to an in-flight write for the whole sequence. `listRegularFiles` unlinked **any** `.tmp-` entry it encountered, and the store's lock is per-store, so a second `MediaStore` opened on the same root does not exclude the first. Its sweep reaped a temporary that a live write still owned, and that write's `link()` failed with `ENOENT` — a save that was proceeding normally reported as a missing file.

The test's two stores share one root, which is the case the acceptance exists to cover, so the defect was in the product's sweep rather than in the test.

## Decision

The sweep reaps a temporary only once it is older than `MEDIA_STORE_TEMP_GRACE_MS`. No single publish sequence spans that grace, so a temporary past it can no longer belong to a live write, while a fresh one is left for its owner to finish and remove.

The age is measured against wall time, not the store's injected `now()`. The question the sweep asks is how long ago some process wrote this file, which a test clock does not describe; reading the injected clock would let a case that moves time forward reap a temporary another process had just created.

`reclaims stale temporaries and strays while keeping live leaves` now ages its temporaries past the grace before sweeping, which is what its name already claimed and what the sweep's contract has always been. `keeps the leftovers a locked-down store directory refuses to release` ages its temporaries too, so the sweep still reaches the unlink its injected faults refuse. A new case, `leaves a fresh temporary alone so a concurrent write can still publish it`, pins the protection directly and fails without the change.

## Alternatives considered

**Take a cross-store lock on the root.** The store's lock is per instance by construction, and a shared-root lock would serialize independent writers for a hazard that only concerns temporary names. It also could not help a second process that never took the lock, which is the situation the acceptance describes.

**Name temporaries with the owning process id and reap only foreign ones.** A pid is reused, and a crashed writer's temporary would then be immortal until its pid recurred. Age answers the actual question — whether any live sequence can still own this name — without depending on process identity.

**Let the publish tolerate `ENOENT` from `link()` and retry.** That hides a reaped temporary behind a retry instead of preventing it, and a retry racing the same sweep can lose again. It also leaves the sweep free to destroy another writer's work, which is the defect.

**Relax the test to accept `ENOENT`.** The test asserts the contract the store exists to provide: exactly one of two racing saves publishes, and the loser fails for a stated reason. Accepting `ENOENT` would record the bug as the specification.

## Consequences

A direct race reproduction at twelve-way contention failed 1 of 720 before the change and 0 of 2160 after. The spec passes 36 of 36 runs across three twelve-way rounds, and `media-store.ts` keeps per-file 100% on statements, branches, functions and lines.

A genuinely abandoned temporary now survives up to `MEDIA_STORE_TEMP_GRACE_MS` longer than before. It occupies bytes that `storedObjectBytes` does not count toward the total ceiling, since that sum reads only digest-named object leaves, so the delay costs disk rather than admission of new artifacts, and the next sweep after the grace removes it.
