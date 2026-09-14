# Agent Note: Windows arm64 desktop target

Status: implemented

English | [中文](2026-09-14-windows-arm64-desktop-target.zh.md)

## Problem

Windows had one Desktop release target, `win-x64`. Windows on Arm devices could run that installer only through x64 emulation, which slows the Electron shell, the bundled Node.js runtime, and every native addon in the seed. `resolveDesktopPackageTarget` also accepted a Windows host only when its Node.js process reported `x64`, so a Windows on Arm workstation running native arm64 Node.js could not package any Windows target.

## Decision

`win-arm64` is a Desktop release target beside `win-x64`. It selects electron-builder's `--win --arm64`, downloads the upstream `node-v<version>-win-arm64.zip` runtime, and produces `aeven-<version>-win-arm64.exe` with the same NSIS, EV signing, and `--unsigned` behavior as `win-x64`.

Both Windows targets require a Windows host whose Node.js process reports the target architecture. Seed preparation runs the bundled target Node.js and pnpm so that platform- and CPU-filtered optional dependencies resolve for that target, and the host check guarantees that this runtime can execute. A Windows on Arm host therefore builds `win-arm64` with arm64 Node.js and `win-x64` with x64 Node.js under emulation.

`win-arm64` publishes through the update channel under `_/harness/desktop/stable/win-arm64/`. The target directory keeps its `latest.yml` or prerelease channel file separate from `win-x64`, so each installed architecture reads only its own installer metadata.

## Alternatives considered

**Ship only the x64 installer to Windows on Arm.** Emulation works without a new target, but every launch pays for translating the Electron shell, Node.js, and native addons. A native target removes that cost and keeps release artifacts matched to the device.

**Combine both architectures in one NSIS installer.** electron-builder can emit a multi-architecture installer, but the upload plan validates exactly one update file per channel metadata document, and the seed is architecture-specific. Separate targets keep each installer, seed, and update directory independently verifiable.

**Cross-package Windows arm64 from a Windows x64 or macOS host.** Seed preparation must execute the target Node.js to resolve CPU-filtered optional dependencies, so a host that cannot run arm64 Windows binaries cannot produce a correct seed.

## Consequences

Windows on Arm users receive a native installer and native updates. Release automation needs a Windows arm64 host, such as a Windows on Arm virtual machine on Apple Silicon or a Windows on Arm runner, with arm64 Node.js and the EV token attached for signed builds.

A seed dependency that publishes no `win32-arm64` native build fails `win-arm64` seed preparation or runtime loading even when `win-x64` succeeds, so the first `win-arm64` package run is the verification point for each native dependency.

## Testing

`apps/desktop/tests/package-target.spec.ts` covers the `win-arm64` selectors, host-target default selection, and the rejection of each Windows target on a host whose Node.js architecture differs. `apps/desktop/tests/desktop-build-paths.spec.ts` covers its isolated build directories and target resolution, `apps/desktop/tests/desktop-auto-update-environment.spec.ts` covers its update directory, and `apps/desktop/tests/desktop-upload-plan.spec.ts` covers its installer and channel metadata upload plan.
