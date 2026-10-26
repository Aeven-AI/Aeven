# Agent Note: Desktop release becomes public after every target

Status: implemented

English | [中文](2026-10-26-desktop-release-public-after-every-target.zh.md)

## Problem

electron-updater's GitHub provider takes the newest public release from the releases feed and downloads that release's channel file (`latest-mac.yml`, `latest.yml`, ...). It does not fall back to an older release. When each target made the release public as it finished, v0.3.16-alpha was public with Linux, win-x64, and unsigned macOS assets while the signed macOS and win-arm64 builds still ran. Installed macOS and Windows clients found no channel file in v0.3.16-alpha, reported no update, and never saw the complete v0.3.15-alpha.

## Decision

Targets still build and upload independently ([per-target upload](2026-10-26-desktop-targets-publish-independently.md)), but into a draft release. A final `publish` job in the [release workflow](../../../../.github/workflows/release-desktop.yml) needs every target and publishes the release only when all of them succeeded. Rerunning a failed target reruns that job.

## Alternatives considered

**Keep early publication and fall back in the client.** On a missing channel file, the desktop updater could look up the newest release that carries one. Installed clients do not have that fallback, so they would keep missing updates until they update some other way.

## Consequences

Every download waits for the slowest target, normally signed Intel macOS in Apple's notarization queue. Installed clients never see a release that lacks their platform's feed.
