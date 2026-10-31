# Agent Note: Dependency patches give way to owned installs

Status: implemented

English | [中文](2026-10-31-dependency-patches-give-way-to-owned-installs.zh.md)

## Problem

Three pnpm patches sat in `patches/`, and every Desktop release target failed at the seed install with `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: msedge-tts@2.1.1`: pnpm 11 refuses a dependency whose lifecycle scripts are neither allowed nor denied, and the seed's generated workspace file named neither. Two of the three patches existed only to make a dependency's own installer survive a platform it does not support, which is the sort of fix that belongs to code we own.

## Decision

**The `app-builder-lib` patch is gone, replaced by a version bump.** Its patch made the pnpm node-module collector walk the children of every occurrence of a `name@version`, because pnpm prints a repeated subtree once. `electron-builder` 26.18.1 fixes that upstream: a `dedupedDependenciesCount` entry now resolves its dependencies from the package's own `package.json` instead of the list output. The direct `app-builder-lib` pin went with it, and `THIRD_PARTY_NOTICES` no longer records the patch.

**The `@googleworkspace/cli` patch is gone, replaced by an install we run.** That package publishes no Windows on ARM build and its installer refuses the host triple. `@aeven/host-account-integrations` now owns the binary: `scripts/ensure-gws.mjs` maps the host to a target triple — the emulated `x86_64-pc-windows-msvc` build on Windows on ARM, musl detection on Linux — downloads the release asset, verifies its published `.sha256`, and writes the executable the connector already names through `GWS_BIN`. The package's own build script is denied in the workspace and in the generated Desktop seed, because on Windows on ARM it throws rather than falling back.

**The read-aloud provider is Aeven's own client.** `@aeven/text-to-speech-edge` carried a patch to point `msedge-tts` at `api.msedgeservices.com`. `src/edge-tts.ts` now speaks the Edge read-aloud WebSocket protocol directly, against that host, with the token scheme that host accepts, and lists voices on the legacy host that still answers a roster. Removing `msedge-tts` also removes the ignored build script that failed the seed install.

**The `node-pty` patch stays.** Unpatched, it resolves `spawn-helper` only inside its own prebuilds directory, while the macOS SEA runtime ships `<exe>-spawn-helper` beside the executable, and the package offers no path option. Owning that means vendoring its JavaScript loader and still taking its binaries from the tarball; the 30-line patch is the smaller surface until upstream offers a seam.

## Verification

The collector was called directly — `getCollectorByPackageManager(PM.PNPM, appDir, new TmpDir()).getNodeModules({ packageName })` — rather than through a packaging run: 26.18.1 and the patched 26.17.0 return the same 19 modules for `apps/desktop`, and on the much larger `@aeven/cli` closure 26.18.1 drops only platform-filtered optional binaries and `@aeven/win32-process`, which no electron-builder collection for this repository reaches. `ensure-gws.mjs` was run end to end on macOS arm64 after removing the existing binary: it fetched the archive, verified the checksum, and `gws --version` reported `gws 0.22.5`. The owned Edge client answered the live service: 322 voices listed, 523 ms cold, 382 ms warm, and 296 ms for the utterance after a cancelled one that reused the socket.

## Alternatives considered

**Keep patching `app-builder-lib`.** Rejected because the patch guards code upstream now produces differently, so it would need rewriting every bump; a bump that carries the fix is the cheaper invariant.

**Fall back to the x64 artifact inside the patched installer.** Rejected because it keeps a patch on a package whose only alternative path is a host triple, and because the fallback is worth nothing on the platforms that do have a build.

**Package `gws` as a sidecar binary.** Rejected as premature: the package's own layout already names `bin/gws`, so writing the binary there keeps one path for every platform and leaves `GWS_BIN` unchanged.

## Consequences

- Any dependency that gains lifecycle scripts must be allowed or denied in the seed's build-script list, or the Desktop seed install fails; this is how the release broke.
- A renamed upstream asset now fails our install loudly instead of a patched installer's silent fallback.
- `node-pty` remains the only patched package, and its patch tracks `spawn-helper` resolution in `lib/unixTerminal.js`.
