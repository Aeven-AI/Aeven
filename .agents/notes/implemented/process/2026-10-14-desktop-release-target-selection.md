# Agent Note: A desktop release target is selected per run

Status: implemented

English | [中文](2026-10-14-desktop-release-target-selection.zh.md)

## Problem

`.github/workflows/release-desktop.yml` held its release targets in a job matrix, so every manual run built all six at once across the macOS, Windows, and Linux runners. A run that needed one installer paid for the other five or was cancelled partway, and there was no way to build the always-unsigned macOS DMG alone while the signed one was blocked on notarization.

## Decision

- **One JSON array in a `plan` job holds the target list.** Each entry carries `id`, `target`, `runner`, and `script`; the unsigned macOS variant adds `variant: unsigned`. The job selects the entries the run asked for and hands them to the `build` job's `matrix` through `fromJSON`, filling in `variant: ""` on entries that lack one so every row carries the same keys. The output is the `{"include": [...]}` object form a dynamic matrix requires: a bare array fails the run with `A sequence was not expected` before any job is scheduled. A `v<version>` tag push, and the `all` input, select every entry.
- **A manual run names one target.** `workflow_dispatch` takes a `target` choice input — `all`, `win-x64`, `win-arm64`, `mac-arm64`, `mac-arm64-unsigned`, `linux-x64`, `linux-arm64` — defaulting to `all`, which is what a tag push builds. The signed and unsigned macOS builds are separate selections, so each DMG is built on its own.
- **`plan` refuses to publish a partial build.** The release job publishes every target's installers and update feeds as one release, so a run with a single target and `publish` set fails in `plan`, before a runner starts packaging.
- **An unrecognized target fails in `plan`** instead of reaching GitHub as an empty matrix, which it would report as a skipped job.

## Alternatives considered

**A `targets` input filtering the existing `include:` list.** The smallest edit to the file, but a static `include:` list cannot be narrowed: every entry still spawns its job, so a filter has to move the list into the matrix expression itself, which is what the `plan` job does.

**A workflow file per target.** Each target would get its own Run button in the Actions sidebar, at the cost of either six copies of the signing, packaging, and collection steps or six thin wrappers over a `workflow_call` build workflow — and the tag release would fan out over all of them either way.

**One job per target, each enabled by its own input.** No shared selection logic, but every job duplicates the step list behind a fixed `runs-on`, and the tag release still needs the fan-out.

## Consequences

- A one-target manual run occupies one runner; the tag release builds and publishes all six as before.
- `build` waits for `plan` — seconds on `ubuntu-latest` — before its matrix resolves, and a `plan` failure stops the run before any runner installs dependencies.
- The target list is a JSON literal inside the `plan` step rather than visible matrix structure, so the workflow header and `apps/desktop/README.md` are where a reader learns what `target` accepts.
