# Agent Note: Desktop updates surface in the application, and never install unasked

Status: implemented

English | [中文](2026-10-17-desktop-update-popup.zh.md)

## Problem

Two defects met in the same surface. The shell's only update surface was a native `dialog.showMessageBox`: a check nobody ran appeared as a system popup, and it carried no progress, so a check, a download, and an install all read the same. And a successful install left its own state behind — electron-updater's staged download under `pending/`, the same release again as the differential baseline (`update.zip`), and Squirrel's `ShipItState.plist` naming a bundle it had already deleted. On a machine that had just updated to the running version that was 770 MB of residue plus a staged install nobody could perform, re-offered by every check ([issue 137](https://github.com/Aeven-AI/Aeven/issues/137)).

Installing was also implicit: `autoInstallOnAppQuit` was on, so quitting installed a release the reader had answered "Later" to, which is what makes an update read as an unannounced relaunch.

## Decision

The application's own popup is the only update surface, and installing is the reader's answer.

- **The shell publishes, the page renders.** `AvnDesktopUpdateApi` (`get`, `check`, `install`, `onChange`) is back on the preload, plus `updatesListen`, by which the page says it shows update state. The shell holds the states it publishes until that subscription exists — and holds a surface request made meanwhile — so a page that never subscribes (another build's client, a Host served elsewhere) shows nothing and is never sent a command it cannot answer. `@aeven/client-ui-update` mirrors the states onto one `shell.overlay` entry.
- **The menu and a finished download both open it.** `Check for Updates…` opens the popup and starts the check; an automatic check stays silent while a release downloads and opens the popup once the download finishes. `update-prompt.ts` still decides whether a state warrants the surface, which is why a failure nobody asked about stays silent.
- **Nothing installs on quit.** The coordinator sets `autoDownload = true` and `autoInstallOnAppQuit = false`. A downloaded release waits until **Restart and install**, which stops the avn child and hands the swap to electron-updater; **Later** dismisses the popup and leaves the release staged for the next launch.
- **A release at or below the running version is not an update.** `doCheck` compares the feed's version with `updater.currentVersion` through semver before publishing `available`, so a staged artefact for the running release can never be offered again.
- **Each launch clears what the last install left.** `clearUpdateResidue()` removes the staged download (only the session that downloaded it can install it), except a Windows installer newer than the running version, which stays for electron-updater to check against the next feed's digest and reuse; it removes the differential baseline and Squirrel's state file only once the release they describe is the running one, and `ShipItState.plist` only when no staged bundle remains beside it. It runs before the coordinator is constructed, so the first check of a launch already sees clean caches.

## Alternatives considered

**Keep the native dialog and only add cleanup.** It leaves the progress gap: a check, a 385 MB download, and an install are indistinguishable, and a system popup for a desktop product the reader is using reads as an interruption from outside the application.

**Keep installing on quit, and ask after the download.** That is the arrangement this note replaces: "Later" then means "install when I quit", which the reader cannot tell apart from "do not install", and the relaunch arrives unannounced.

**Clear the whole updater cache on every launch.** Simple, but it deletes the differential baseline every time, so every release downloads in full; the staged-download test is cheap and keeps the baseline whenever a newer release is still staged.

**Read the staged version from `update-info.json`.** The descriptor carries only a file name, a hash, and an admin flag — no version — so the artifact name is where the version is, and the name is the updater's own artifact template (`aeven-<version>-<os>-<arch>`).

## Consequences

Quitting without answering keeps the staged download on disk until the next launch clears it, and the next check downloads the release again — except on Windows, where a newer installer stays and is reused once the checked feed's digest matches it. That is the cost of never installing unasked, and it is bounded to one release's size.

The popup is desktop-only: the browser build has no carrier and registers nothing. A page that subscribes late still gets the shell's latest state and any pending surface request, so the menu works during the first seconds of a launch.

An interrupted swap still leaves the application directory without its bundle until ShipIt's own retry or a manual reinstall; this note does not make installation atomic, and that remains Squirrel.Mac's behaviour ([packaging and updates](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md)).

## Verification

`apps/desktop/tests/update-coordinator.spec.ts` covers the background download, the download-free install, the disabled quit install, the progress state, the running-version guard, the disabled process, and a failed check. `apps/desktop/tests/update-prompt.spec.ts` covers which states open the surface. `apps/desktop/tests/update-residue.spec.ts` covers clearing a completed install's state, keeping a newer staged release's baseline, an unreadable descriptor, artifact-name parsing, the cache directory in `app-update.yml`, the bundle identifier, and the platform cache roots. `packages/client/ui-update/tests` covers every popup phase, the restart and dismissal answers, the menu command, the shell's states, and disposal. The packaged path itself was not exercised: seeing an install needs a published newer release and an installed build.

[Issue 138](https://github.com/Aeven-AI/Aeven/issues/138) — the window's drag band from the first painted frame — is a separate change.
