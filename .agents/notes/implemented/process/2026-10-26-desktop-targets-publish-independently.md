# Agent Note: Desktop targets publish independently

Status: implemented

English | [中文](2026-10-26-desktop-targets-publish-independently.zh.md)

## Problem

A release job that needs the entire build matrix withholds every completed installer while signed Intel macOS waits for Apple. A single failed target also prevents publication of unrelated platforms.

## Decision

The [release workflow](../../../../.github/workflows/release-desktop.yml) calls one [reusable workflow](../../../../.github/workflows/release-desktop-target.yml) per selected target. Each invocation uploads after its own build succeeds. Publication jobs share a repository-wide concurrency group with `queue: max`, so release creation and feed replacement are serialized without cancelling pending targets. The first completed target creates a draft release and later targets add their assets to it; the release becomes public only after every target has uploaded ([publication rule](2026-10-26-desktop-release-public-after-every-target.md)). Installers and blockmaps upload before any feed referencing them.

Linux publishes each target's feed immediately. Windows and macOS upload architecture-suffixed manifests and publish their shared feed only when both architectures' manifests exist in the release. The merger keeps x64's top-level fields. Unsigned macOS contributes only its DMG. The updater can fall back to another architecture when its own installer is absent, so a partial shared feed is unsafe.

The [target-selection policy](2026-10-14-desktop-release-target-selection.md) still requires publishing runs to select every target; each successful build uploads regardless of the other targets. The [macOS job ceiling](2026-10-15-macos-release-builds-run-to-the-github-ceiling.md) limits only that target's availability.

## Alternatives considered

**Publish after the whole matrix.** This prevents partial releases but lets one platform's signing queue block every download.

**Publish a shared feed with only the completed architecture.** This makes update metadata available sooner but can offer an incompatible installer to the other architecture.

**Give each architecture its own updater channel.** This also separates automatic updates, but requires a client configuration change and does not change installed clients that request the shared channel.

## Consequences

A failed build leaves a draft release and a failed workflow; rerunning it adds the missing target and publishes the release. Target manifests remain public release assets so later publishers can merge without downloading other targets' installers. The current running workflow retains its original job dependencies; this change applies to future runs.
