# Agent Note: A desktop release target is selected per run

Status: implemented

English | [中文](2026-10-14-desktop-release-target-selection.zh.md)

## Problem

`.github/workflows/release-desktop.yml` held its release targets in a job matrix, so every manual run built all six at once across the macOS, Windows, and Linux runners. A run that needed one installer paid for the other five or was cancelled partway, and there was no way to build the always-unsigned macOS DMG alone while the signed one was blocked on notarization.

## Decision

- **One JSON array in a `plan` job holds the target list.** Each entry carries `id`, `target`, `runner`, and `script`; the unsigned macOS variant adds `variant: unsigned`. The job selects the entries the run asked for and hands them to the `build` job's `matrix` through `fromJSON`, filling in `variant: ""` on entries that lack one so every row carries the same keys. The output is the `{"include": [...]}` object form a dynamic matrix requires: a bare array fails the run with `A sequence was not expected` before any job is scheduled. A `v<version>` tag push, and the `all` selection, select every entry.
- **A manual run names one or more targets.** `workflow_dispatch` takes a comma separated `targets` string input, defaulting to `all`, which is what a tag push builds. The signed and unsigned macOS builds are separate names, so naming both builds both DMGs; [the multi-target Agent Note](2026-10-16-desktop-release-selects-several-targets.md) records why the single-target choice input it replaced lost.
- **`plan` refuses to publish a partial build.** A publishing run selects the full release target set, so a run that names fewer than every target and sets `publish` fails in `plan`, before a runner starts packaging. Each completed target [publishes independently](2026-10-26-desktop-targets-publish-independently.md).
- **An unrecognized target fails in `plan`** instead of reaching GitHub as an empty matrix, which it would report as a skipped job; a selection that names no target fails the same way.

## Alternatives considered

**A `targets` input filtering the existing `include:` list.** The smallest edit to the file, but a static `include:` list cannot be narrowed: every entry still spawns its job, so a filter has to move the list into the matrix expression itself, which is what the `plan` job does. The shipped `targets` input holds the selection as a comma separated string for that same reason — `workflow_dispatch` has no multi-select input type — rather than filtering a static list ([Agent Note](2026-10-16-desktop-release-selects-several-targets.md)).

**A workflow file per target.** Each target would get its own Run button in the Actions sidebar, at the cost of either six copies of the signing, packaging, and collection steps or six thin wrappers over a `workflow_call` build workflow — and the tag release would fan out over all of them either way.

**One job per target, each enabled by its own input.** No shared selection logic, but every job duplicates the step list behind a fixed `runs-on`, and the tag release still needs the fan-out.

## Consequences

- A manual run occupies one runner per named target; the tag release builds and publishes all eight as before.
- `build` waits for `plan` — seconds on `ubuntu-latest` — before its matrix resolves, and a `plan` failure stops the run before any runner installs dependencies.
- The target list is a JSON literal inside the `plan` step rather than visible matrix structure, so the workflow header, the `targets` input description, and `apps/desktop/README.md` are where a reader learns which names the input accepts.
