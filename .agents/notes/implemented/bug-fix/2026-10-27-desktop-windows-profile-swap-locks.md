# Agent Note: Windows locks during the desktop profile swap

Status: implemented

English | [中文](2026-10-27-desktop-windows-profile-swap-locks.zh.md)

## Problem

On Windows, the unsigned desktop build stopped at its start screen with `EBUSY: resource busy or locked, rename '…\.aeven\desktop\staging\<id>\profile' -> '…\.aeven\profiles\desktop'`, thrown by `DesktopProjectManager.activate`. The [profile activation](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) renames directories once, and Windows refuses a directory rename while a process holds a handle that blocks it.

The error code names the kind of handle. On Windows 11 with Node.js 26, renaming a directory fails with `EPERM` while a file inside it is open without delete sharing, as a scanner opens it, and also while a process has a subdirectory as its working directory. It fails with `EBUSY` while a process has the renamed directory itself as its working directory. The staged health-check Host ran with the staged profile as its working directory, and every process it started inherited that directory; stopping the Host does not stop its descendants on Windows.

The swap's error path had two further defects. When the swap failed before the active profile moved to `rollback/profile`, the cleanup deleted `profiles/desktop`, which was still the active profile. A cleanup that failed on the same lock threw its own error in place of the one that stopped the swap.

## Decision

- Every directory rename of the swap, its recovery, and prepared-profile adoption goes through `renameRetryingWindowsLocks`. On Windows it retries `EBUSY`, `EPERM`, and `EACCES` with a delay that starts at 50 ms, doubles, is capped at 1 s, and stops after 60 s; on other platforms the first error is thrown. `removeOwnedDirectory` passes `maxRetries: 10` to `rmSync`. `recover()` and prepared-profile adoption are asynchronous because the retry waits.
- `DesktopHostProcess` takes the Host's working directory. The staged health-check Host runs from `~/.aeven/desktop/work` (`DesktopPaths.work`), outside every profile. The serving Host keeps its profile as its working directory, which sessions without a directory use for shell commands, relative paths, and the sandbox fallback root. The Desktop Host passes its profile to `loadLayeredEnv`, so the project `.env` layer is the profile's in both cases.
- `activate` undoes only the moves that happened, by renaming the activated profile back to staging and `rollback/profile` back to `profiles/desktop`. An undo that fails is logged, keeps `pending.json` for the next launch's `recover()`, and the swap's own error is thrown. A leftover staging or store-transaction directory that cannot be removed is logged and kept.

## Alternatives considered

**Retry the rename and change nothing else.** A retry covers a holder that releases its handle within the deadline. A descendant of the health-check Host that keeps running holds the staged profile for its whole lifetime, and the reported `EBUSY` matches that holder, so the retry alone would fail the same way after 60 s.

**Run the serving Host outside its profile as well.** That removes the same holder from the update path, where the serving Host's profile moves to `rollback/profile`, but it changes the fallback directory of sessions without a directory from the installed profile to an empty directory. The owner kept those sessions unchanged. A process the serving Host leaves running can therefore still block an update; the swap then fails without touching the active profile.

**Run pnpm outside the profile with `--dir`.** pnpm 11.7.0 runs the project's lifecycle scripts with the project directory as their working directory whatever directory pnpm starts in, and `runPnpm` waits for pnpm to exit before the swap, so the change removes no holder.

**Delete the activated profile instead of renaming it back.** Deletion can stop partway on a held file and leave a partial profile that `recover()` keeps, because recovery restores `rollback/profile` only when `profiles/desktop` is absent. A rename either completes or leaves both complete directories in place.

## Consequences

- A first launch or update on Windows survives a lock that clears within 60 s, and the health-check Host's descendants no longer hold the staged profile. A holder that lasts longer still fails the start, now after 60 s.
- A swap that fails before or after its moves leaves the active profile in place or restores it, and the start screen reports the error that stopped the swap.
- An install-script process that keeps running inside the staged profile, or a process the serving Host leaves running inside the active profile, can still block the swap.
- The holder in the reported failure was not identified on the reporting machine; the `EBUSY` code and the reproduction above make the health-check Host's working directory the most likely holder.
- A staging directory that cannot be removed stays under `~/.aeven/desktop/staging` until a later cleanup removes it.
- `apps/desktop/tests/host-process.spec.ts` pins the Host's working directory and, on Windows, renames a stopped Host's profile while a process it started is still running. `apps/desktop/tests/project-manager.spec.ts` pins that the active profile survives a swap that fails before its first move. The retry was exercised against a simulated file lock outside the test suite; neither it nor the change as a whole has run in an installed Windows build.
