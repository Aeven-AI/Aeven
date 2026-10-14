# Agent Note: Desktop starts on macOS 14, replaces stale profiles, and keeps a failed start inspectable

Status: implemented

English | [中文](2026-10-14-desktop-startup-on-macos-14-and-stale-profiles.zh.md)

## Problem

The unsigned macOS DMG failed on a machine that had run an earlier build. The installed `~/.aeven/profiles/desktop` came from a build with Host protocol 4 under the same `0.1.2-alpha.5` version, and startup threw `invalid desktop release metadata` instead of reinstalling. Because the version string alone decided whether a profile was current, no rebuild under an unchanged pre-release version would have replaced it. The plugin carry-over also validated the old profile's `pnpm-workspace.yaml` against the current workspace format, so an older profile could not upgrade even once the version check passed.

Separately, the Cordis Loader reached Node's internal module loader only through node-addon-require-builtin, whose darwin-arm64 build declares macOS 15 as its minimum; on macOS 14 the addon does not load and the Desktop Host loses bare-specifier plugin imports. The application declared no minimum macOS version.

The application menu, and with it View → Toggle Developer Tools, was installed only after the backend started, and a startup failure showed a dialog and exited, so a failed start offered no way to inspect it.

## Decision

- **The Desktop Host starts with `--expose-internals`.** The Loader already prefers the flag over the addon, so the Host no longer depends on the addon's platform floor. `mac.minimumSystemVersion` is `14.0`, the floor of the bundled onnxruntime-node binary.
- **A profile is current only when its `desktop-release.json` and `desktop-packages.json` equal the seed's byte for byte** and its installed avn and Desktop Host versions match. The package set records each tarball's SHA-512, so a rebuild or a Host protocol change under one version reinstalls. The installed release file is read for its version without requiring the current Host protocol.
- **The upgrade reads only the old profile's bundle list and installed plugin manifests.** The core-mapping check runs on the staged profile, which the current code wrote, so the accommodation for profiles without dependency patches is gone.
- **The application menu is installed before the backend is planned or started.** A manual update check clicked during startup waits for startup to finish, so the installer never quits the shell mid-install.
- **A startup failure opens a window with the error**, including the backend's stderr, instead of a dialog that exits. The menu stays, Developer Tools opens on that window, and closing it exits with status 1.

## Alternatives considered

**Bump the release version on every build.** It would make the version comparison sufficient, but pre-release builds are dispatched from branches without a version bump, and a protocol change would still depend on someone remembering to bump.

**Ask upstream to rebuild node-addon-require-builtin for an older macOS.** It would also fix macOS 14, but the flag removes the dependency on Desktop entirely and needs no external release.

**Treat an unreadable old profile as absent and install fresh.** Simpler, but it would silently drop the user's installed Desktop plugins.

## Consequences

- An upgrade from a profile written by any earlier build of the same version reinstalls once; later launches reuse it.
- Every Desktop Host process can reach Node internals, which the addon already allowed on supported platforms.
- macOS 13 and earlier refuse to open the application with the system's version message.
