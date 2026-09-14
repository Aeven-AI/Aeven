# Agent Note: Linux desktop packages and unsigned builds

Status: implemented

English | [中文](2026-09-14-linux-desktop-packages-and-unsigned-builds.zh.md)

## Problem

Desktop release packaging supported three targets and demanded a complete signing identity for each of them. Two separate needs could not be met.

A contributor without an Apple Developer ID or a Windows EV token could not produce a runnable artifact at all. Every macOS package required the certificate qualifier, the Team ID, and one complete notary credential set; every Windows package required the SignTool, the EV token, and its PIN. Neither path had a supported way to build something a developer could launch, so reviewing the packaged application meant holding release credentials.

Linux had no release target. [Package and update the Electron desktop application](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md) records that decision for the initial release, and the fixed target list, the auto-update directory map, the upload plan, and the electron-builder configuration all encoded it. Linux also cannot reuse the signing story of the other platforms, because electron-builder packages AppImage and deb artifacts without a code-signing identity, and the update channel is an Electron updater feature with no Linux consumer.

Two defects independently prevented any package command from completing. The Landlock packaging step read `native/system`, a directory that no longer exists in this tree; the workspace moved to `native/landlock-run`. The Desktop Host overlay did not disable the `workspace-files` entry, whose file URLs are an HTTP route on the webserver that the Desktop composition disables.

## Decision

The supported target set is `mac-arm64`, `mac-x64`, `win-x64`, `linux-arm64`, and `linux-x64`. Each target keeps the fixed platform and architecture selectors that runtime preparation, seed preparation, and electron-builder must agree on.

Linux packages without code signing and is distributed directly rather than through the update channel. A matching Linux host builds it, and any Docker host builds it through a container command. The `upload:*` commands reject both Linux targets, and `DesktopUploadTargetName` excludes them from the upload plan at the type level.

An unsigned build is available for macOS and Windows through the `--unsigned` flag and the matching `package:*:unsigned` scripts. It skips seed signing, application and installer signing, macOS notarization, the DMG artifact hook, and the completion record that upload requires. Signed packaging is unchanged and remains the only path that can publish.

The Landlock packaging step reads `native/landlock-run`, and the Desktop Host overlay disables `workspace-files`.

## Linux targets

electron-builder emits an AppImage and a deb for `--linux`, and both architectures map onto its existing `--arm64` and `--x64` selectors. The Linux configuration names the executable `aeven` and declares `Aeven` as the deb maintainer.

The deb exists because Chromium's setuid sandbox helper is what lets a distribution that restricts unprivileged user namespaces start the AppImage. Distributions in that state can install the deb instead.

`desktopTargetBuildPaths` and the auto-update target map both accept the two Linux names, so a Linux target owns its prepared runtime, package set, seed, pnpm state, and artifacts under its own `.desktop-build/targets/<target>/` directory exactly as the other targets do. The auto-update target map recognizes Linux so that build-path resolution accepts it; no Linux artifact has an updater channel.

`resolveDesktopPackageTarget` requires a Linux host with the same architecture. A target whose architecture differs from its host is rejected with a message that names the Docker command, because the seed and the bundled Node.js runtime are both architecture-specific.

## The Linux container build

`package-linux-container.ts` removes the matching-host requirement without weakening it. It builds `linux-builder.Dockerfile` for the target architecture, streams the files git would commit together with `.git` into the container as a tar stream, runs the same `package:<target>` script there after a fresh `pnpm install --frozen-lockfile`, and copies the top-level artifacts back into the target's host artifacts directory.

The image carries only tools: Ruby and the `fpm` gem for deb packaging, with `USE_SYSTEM_FPM=true`, and the pnpm version the root manifest declares. The repository itself arrives at run time, so the image holds no repository content and needs no rebuild when the source changes. electron-builder's bundled fpm supports x64 only, which is why deb packaging installs a system fpm on both architectures.

Three inputs are forwarded deliberately: `DSH_DESKTOP_APP_ID`, `DSH_DESKTOP_AUTO_UPDATE_ENV`, and `DOWNLOAD_TEST_ORIGIN`. The store lives in the `dsh-desktop-linux-pnpm-store` volume, so repeat builds reuse downloaded packages without sharing the host's store. `--platform linux/arm64` and `linux/amd64` select the container architecture, and a target whose architecture differs from the Docker host runs under emulation.

A `trap` copies whatever electron-builder finished before the container exits, so one artifact survives a later target failing in the same run. The `COPYFILE_DISABLE` environment variable and `--no-xattrs` keep a macOS host's tar from adding AppleDouble entries and extended-attribute headers that Linux would reject.

## Unsigned builds

`DSH_DESKTOP_UNSIGNED=1` is the single input. `parseDesktopPackageInvocation` accepts `--unsigned`, the packaging script deletes any inherited value from the target environment and sets its own, and `createElectronBuilderConfig` reads it once to derive the signing decisions.

For macOS the configuration sets `forceCodeSigning`, `hardenedRuntime`, `notarize`, and the DMG `sign` flag to false, and sets `identity` to `-`. Ad-hoc signing is not optional there: Apple Silicon refuses to launch code that carries no signature at all, while hardened runtime would reject the seed's unsigned native addons. The after-sign and artifact hooks return early, so no release identity or notary credential is resolved. For Windows the configuration clears `forceCodeSigning` and installs no token signer, so the signing CMD never runs.

Seed preparation skips its Mach-O signing pass under the same variable. An unsigned build writes no completion record, which is what makes `upload:*` refuse it rather than publish an artifact that no identity vouches for.

An unsigned artifact is for local verification. Gatekeeper blocks a downloaded macOS copy until the tester removes its quarantine attribute, and Windows SmartScreen warns before an unsigned installer runs.

## Alternatives considered

**Require credentials and document a self-signed certificate instead.** A self-signed identity still needs a keychain entry, a Team ID, and a trust decision on the reviewing machine, and it would not explain why the macOS application needs an ad-hoc signature to start. The `--unsigned` flag states the actual capability, which is that packaging works with no identity at all.

**Build Linux on the host only.** Requiring a matching Linux host with the Desktop toolchain excludes the macOS and Windows workstations where the desktop application is developed, and a contributor would have to reproduce Ruby, fpm, Node.js, and pnpm by hand. The container path reuses one image and one forward list instead.

**Cross-package Linux with electron-builder from macOS.** electron-builder cannot produce a Linux seed. Seed preparation runs the target Node.js and bundled pnpm so that platform- and CPU-filtered optional dependencies resolve correctly, which is impossible for a Linux target from a macOS host without a Linux runtime.

**Add Linux to the update channel.** electron-updater has no Linux consumer in this application, and publishing an AppImage or deb to the update channel would advertise an update path that no installed Linux artifact can read. Linux packages are distributed directly instead.

**Extend `--unsigned` into a full release mode.** Producing an unsigned artifact that upload accepts would let a build without a release identity reach users. Withholding the completion record keeps the signature requirement attached to publication rather than to packaging.

## Consequences

A developer can now build and launch the packaged application on any platform without holding release credentials, and the packaged paths that previously required a release identity are reviewable locally.

Linux gains a release target, which means the platform table in the [packaging note](../architecture/2026-08-25-electron-desktop-packaging-and-updates.md), both Desktop READMEs, and the target lists in code and tests move together. Adding a target now touches the build-path map, the auto-update map, the target table, the upload target type, and the package script manifests.

The unsigned mode is a development path, not a release path. It is deliberately unavailable from `upload:*`, and an unsigned macOS artifact is quarantined by Gatekeeper for anyone who receives it.

The Docker path builds a repository tar stream plus a store volume; the first build pays for the image and a full dependency install, and a cross-architecture build pays for emulation on top of that.

Two defects are fixed in the same change because neither could be verified without a working package command: the stale Landlock packaging directory and the enabled `workspace-files` route in the Desktop Host overlay.

## Testing

`apps/desktop/tests/package-target.spec.ts` covers the Linux selectors, the matching-host requirement, the Docker-command rejection message, and `--unsigned` parsing. `apps/desktop/tests/desktop-build-paths.spec.ts` and `apps/desktop/tests/desktop-auto-update-environment.spec.ts` cover the Linux target resolution and keep the unsupported-target rejection by asserting it for a platform outside the supported set. `apps/desktop/tests/macos-signature.spec.ts` covers the unsigned macOS configuration, including the ad-hoc identity and the inert artifact hook, and the unsigned Windows configuration without the EV token signer. `apps/desktop/tests/desktop-upload-plan.spec.ts` covers the upload plan against the narrowed upload target type.
