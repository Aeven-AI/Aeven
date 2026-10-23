# Agent Note: Desktop updates are prepared before the restart

Status: implemented

English | [中文](2026-10-23-desktop-update-prepared-before-restart.zh.md)

## Problem

Installing a desktop release read as a crash. The [update popup](../feature/2026-10-17-desktop-update-popup.md) offered the restart as soon as electron-updater had downloaded the ZIP, but most of the work still lay ahead. With `autoInstallOnAppQuit` off, `MacUpdater.quitAndInstall` only then asked Squirrel.Mac to fetch the ZIP from the updater's local feed, verify its signature, and unpack it, and `beforeRestart` had already stopped the Host, so the window showed an application with no backend for that whole time. The first launch of the new release then ran `DesktopProjectManager.applyRelease`, which hashed the 562 MB seed with `readFileSync`, extracted the pnpm store with synchronous `tar`, and copied it with `cpSync` on Electron's main thread: about 70 seconds in which the window could not repaint, move, or answer input. The start screen showed only a spinner, and **Check for Updates…** chosen during it answered nothing until startup finished.

## Decision

The release is installed in the background before the popup offers the restart, and every step that remains runs off the main thread with visible status.

- `DesktopUpdateCoordinator` takes a `prepare(version)` step. After the download it publishes the new `preparing` phase, awaits `prepare`, and only then publishes `ready`; a failed `prepare` reports the update as failed.
- On packaged macOS, `main.ts` implements `prepare` with `apps/desktop/src/update-staging.ts`. `stageNativeUpdate()` calls Electron's native `autoUpdater.checkForUpdates()` against the feed electron-updater serves, so Squirrel stages the bundle during the download rather than after the restart; the shell remembers the staged version, so a later periodic check does not stage it again. `stagedReleaseResources(shipItDir, version)` finds the staged `update.*/*.app` whose `CFBundleShortVersionString` matches, and `DesktopProjectManager.prepareRelease(seed, version, runtime)` installs that release's profile into `~/.aeven/desktop/prepared/profile` with the staged bundle's own Node.js and pnpm, merging its pnpm store into the persistent one. A profile that cannot be prepared is logged and left to the first launch.
- `applyRelease` adopts a prepared profile installed from its exact seed with the active profile's plugins, which leaves the health check and the directory swap, and discards any other prepared profile. It reports `unpacking`, `installing`, and `checking` through `DesktopProjectHooks.progress`, which the shell writes under the start screen's spinner as "Updating Aeven to {version}: …".
- `verifySeedIntegrity`, `extractPnpmStoreArchives`, and `mergePnpmStore` are asynchronous: files are hashed one at a time with `fs/promises`, the archives are listed and extracted with `tar` streams, and the store is copied with `fs/promises.cp`.
- **Check for Updates…** chosen during startup writes a line on the start screen and opens the popup once the page is up.

Windows and Linux keep the download-then-restart flow, with the non-blocking first launch and its status line.

## Alternatives considered

**Set `autoInstallOnAppQuit` again.** That makes `MacUpdater` stage the bundle itself, but it also installs on every quit through the updater's quit handler, which the [update popup note](../feature/2026-10-17-desktop-update-popup.md) removed so a restart stays the reader's answer. Staging through the native updater gets the staging without the quit handler; Squirrel still installs a staged bundle when the application quits, which is Squirrel's behaviour, not the updater's.

**Move the seed steps into a worker thread.** A worker needs its own bundled entry, which the source-run tests and the development launch do not have. The asynchronous file and tar APIs keep the event loop turning with the existing code paths.

**Unpack the seed from the downloaded ZIP.** This would work before Squirrel stages anything, but it needs a ZIP reader for a 425 MB archive, and Squirrel unpacks and verifies the same bundle anyway; reading the staged bundle reuses that verified copy.

**Prepare with the running release's Node.js and pnpm.** The native dependencies would then be built for the old runtime. The staged bundle carries the runtime its first launch uses, so the prepared profile matches what that launch would have installed.

## Consequences

- A restart answered from the popup now swaps applications: the Host stops and the staged bundle installs within seconds, and the first launch runs one health-check Host boot before the real one.
- On macOS a staged release also installs when the reader quits without choosing the restart.
- `prepareRelease` holds the project lock while it installs, so a plugin change during that minute reports another transaction as active.
- A prepared profile occupies a profile's worth of disk under `~/.aeven/desktop/prepared` until the release launches or another prepare replaces it.
- The improvement applies from the first update made by a release that carries this code; earlier releases update with their own logic.
- `apps/desktop/tests/update-coordinator.spec.ts` pins the `preparing` phase between the download and `ready`; `apps/desktop/tests/seed-store.spec.ts` and `apps/desktop/tests/project-manager.spec.ts` exercise the asynchronous extraction, merge, and verification. The staged-bundle path and the prepared-profile adoption were typechecked and built but not exercised: they need a published newer release and an installed build.
