# Agent Note: The desktop application ships an embedded Cua Driver

Status: implemented

English | [中文](2026-10-16-desktop-ships-an-embedded-cua-driver.zh.md)

## Problem

[Issue 128](https://github.com/Aeven-AI/Aeven/issues/128): on a clean macOS install computer use registered no tools. The composition pointed the provider at `/Applications/CuaDriver.app/Contents/MacOS/cua-driver`, which a clean machine lacks, so the provider registered only its install-guidance tool and nothing told the person why. Windows and Linux installs had the same dependency on a separate driver install.

Shipping CuaDriver.app inside Aeven.app does not help on its own: the standalone driver hardcodes `/Applications/CuaDriver.app` for its LaunchServices daemon launch and its `permissions grant` flow, and its signature carries a provisioning profile that a re-signed copy would invalidate.

## Decision

`prepare-runtime` downloads the bare driver executables of a pinned `cua-driver-rs` release for each target (the universal macOS binary, and the arm64 or x86_64 Windows and Linux builds), verifies them against the release `checksums.txt`, and places them in `runtime/cua-driver`. electron-builder signs them with the other nested executables; `scripts/helper-entitlements.plist` adds Apple Events to electron-builder's inherit template, and Info.plist gains Screen Recording and Apple Events usage descriptions, because macOS attributes those requests to Aeven.

The packaged shell sets `AVN_CUA_DRIVER` to the shipped driver and `AVN_CUA_DRIVER_EMBEDDED=1` unless the launching environment already names a driver. The composition maps that flag to the provider's `embedded` field, which starts `cua-driver mcp --embedded --direct` with `CUA_DRIVER_EMBEDDED=1`. Upstream's [embedding guide](https://github.com/trycua/cua/blob/cua-driver-rs-v0.35.4/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md) defines that mode: the driver stays in the spawner's responsibility chain, so macOS answers its Accessibility and Screen Recording checks with Aeven.app's grants and the driver never prompts. The desktop Host is a direct child of the Electron process, so the chain reaches Aeven.app; `health_report` confirms it with `bundle_identity` naming `com.aeven.desktop`.

In embedded mode on macOS `computer_use_setup` requests the grants for Aeven through `osascript` JXA (`AXIsProcessTrustedWithOptions` with the prompt option and `CGRequestScreenCaptureAccess`), which also runs in the Host's chain. A Screen Recording grant reaches the running driver only after Aeven restarts, so the result tells the person to reopen Aeven.

## Alternatives considered

**Copy CuaDriver.app into `/Applications` on first run.** That writes outside the application bundle, needs an administrator account, and leaves a second application with its own permission entries.

**A daemon launched with `serve --embedded` plus an MCP proxy on a private socket.** The upstream guide offers it for hosts that share one driver across clients; Aeven has one MCP client per Host, so `--direct` keeps one process and no socket lifecycle. Its cost is the missing agent-cursor overlay on macOS.

## Consequences

A Developer ID re-signature or a moved application orphans earlier grants, as for any macOS application. A machine that already uses a standalone CuaDriver keeps it when Aeven is launched with `AVN_CUA_DRIVER` set; the packaged application otherwise prefers the shipped driver. Updating the driver means changing `CUA_DRIVER_VERSION` in `apps/desktop/scripts/prepare-runtime.ts`.
