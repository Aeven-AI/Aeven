# Agent Note: Windows precomputed profile layout

Status: implemented

English | [中文](2026-10-29-windows-precomputed-profile-layout.zh.md)

## Problem

A fresh Windows 0.3.28-alpha profile spends 104 seconds in the bundled pnpm installation after store extraction. Parallel archive extraction addresses only the [unpacking cost](2026-10-27-desktop-release-install-speed.md). The release already installs this exact dependency graph during packaging, including native builds and downloaded executable side effects.

## Decision

Windows packaging records the verified hoisted `node_modules` layout before deleting it. Each file names a SHA-512 content object in the seed store; generated files absent from the store enter that same store before its archives and integrity inventory are produced. The descriptor adds paths and pnpm metadata, rather than a second copy of the dependency tree.

Installation validates the descriptor and architecture, creates directories, and hard-links complete store objects into the staging profile in bounded batches. Objects freshly extracted from integrity-verified archives retain that verification through the transaction's same-volume rename; a reused writable-store object receives one SHA-512 check however many profile files share it. The extraction result names only files actually written, excluding skipped existing files. Installation rewrites pnpm's store and virtual-store locations for the installed home and omits the build host's workspace-state cache. Windows hoisted layouts containing symbolic links fail packaging rather than preserving a build-host junction. A descriptor that is present but malformed fails installation before any package file is linked. A file the filesystem refuses to hard-link because the content object reached its link limit is copied instead, with exclusive destination creation, so a store object shared by more files than NTFS's 1,024 links still installs.

The complete seed inventory is verified before this path runs. Staging, backend health checks, activation journaling, rollback, and exact-version restoration of user plugins remain owned by the project manager. A release carrying a layout skips the initial pnpm install; plugin restoration still uses pnpm. POSIX releases use their existing offline installation path.

## Alternatives considered

**Ship a second preinstalled dependency archive.** It duplicates the package bytes already needed in the store for upgrades and plugin operations. A layout descriptor reuses those bytes and requires no additional archive extraction.

**Disable pnpm store integrity checks.** This weakens validation of the persistent writable store and still repeats dependency installation. Recreating the verified packaged layout removes that work without changing pnpm's integrity policy.

## Consequences

On the reporting Windows machine, recreating the real 22,541-file dependency tree takes 20.4 seconds when the store objects have just been verified, compared with 104 seconds for pnpm installation. Rechecking all content digests before linking takes 33.9 seconds. The reconstructed backend boots successfully, and a subsequent bundled pnpm offline installation completes in 4.7 seconds. These are individual phase measurements, not a rebuilt installer's end-to-end startup time.

Packaging owns the expensive installation and layout hashing. First launch still verifies and extracts the seed and boots the staged backend, but does not resolve dependencies or rerun their build scripts. Store and staging must share a volume, as they do under Desktop's managed home; a hard-link failure rejects the transaction rather than silently copying every file, except at the filesystem's link limit, where that one file is copied. All writes in a batch settle before cleanup can remove staging. Unit tests cover content deduplication, metadata relocation, invalid paths, architecture mismatch, and missing content. The project-manager test proves activation and health checks without an executable pnpm entry.
