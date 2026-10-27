# Agent Note: The desktop release builds no unsigned macOS variant

Status: implemented

English | [中文](2026-10-27-drop-unsigned-mac-release-targets.zh.md)

## Problem

The release built `mac-arm64-unsigned` and `mac-x64-unsigned` beside the signed macOS targets, so a DMG was available while notarization was pending. Notarization now completes, and the variants earn nothing: each contributes only a DMG, never a ZIP or a feed entry, so `latest-mac.yml` never names them and the updater cannot install one. On `0.3.20-alpha` the `mac-x64-unsigned` build failed in its Package step after 32 minutes, and because publishing needs every release target, that one unread DMG held the whole release as a draft.

## Decision

`.github/workflows/release-desktop.yml` lists six release targets: `win-x64`, `win-arm64`, `mac-arm64`, `mac-x64`, `linux-x64`, and `linux-arm64`. The reusable `release-desktop-target.yml` drops its `variant` input and every branch that read it: the unsigned-variant short-circuit in the signing decision, the DMG-only asset collection, and the artifact and job name suffixes. The `plan` job no longer fills a `variant` key into each matrix row.

The signing fallback stays. A Windows or macOS target whose secrets are all absent still builds unsigned, which is how a credential-free fork produces installers, and a partly configured target still fails in `plan`'s sibling step.

## Alternatives considered

Keeping both targets and rerunning the failed job retries an artifact nothing downloads, and the release stays a draft until it passes. Deleting only `mac-x64-unsigned` leaves the same dead DMG on arm64 and the whole `variant` plumbing behind it.

## Consequences

A macOS release publishes the signed, notarized DMG and ZIP only. The manual `targets` input no longer accepts the two unsigned ids; a run that names one fails in `plan` and prints the six known targets. `apps/desktop/tests/update-residue.spec.ts` still parses `-unsigned.zip` asset names: that is residue cleanup for staged update files, independent of which targets the release builds.
