# Agent Note: A desktop release run names several targets

Status: implemented

English | [中文](2026-10-16-desktop-release-selects-several-targets.zh.md)

## Problem

The workflow's concurrency group (`release-desktop-${{ github.ref }}`) keeps one pending run, so a dispatch that arrives while another run waits in that group replaces it. A run that needed two installers therefore had to be dispatched twice, and the second dispatch cancelled the first before a runner picked it up, so the two targets could only be built one after the other, a full build apart. Selecting `all` was the only way to build them together, at the price of every other target and both unsigned macOS variants.

## Decision

- **The manual input is a comma separated `targets` string.** `workflow_dispatch` has no multi-select input type ([community discussion](https://github.com/orgs/community/discussions/34298)), so the operator types the selection: `mac-arm64,mac-x64`, a single target, or `all` for every target, which is the default and what a tag push builds.
- **`plan` splits and validates the selection.** The step splits the string on commas, drops surrounding whitespace and empty entries, fails on a name the target list does not carry, and fails on an empty selection. The matrix keeps the target list's order and collapses a repeated id into one row, so a target builds once however often it is named.
- **The publish gate compares sizes.** `publish` still needs every target, so `plan` compares the matrix row count with the target list length instead of comparing one input against `all`.

The target list, the `plan`/`build` split, and the release job come from [the target-selection Agent Note](2026-10-14-desktop-release-target-selection.md), whose single-target input this decision replaces.

## Alternatives considered

**Two single-target dispatches.** The behavior this replaces, and the reason for the change: the concurrency group keeps one pending run, so the second dispatch cancelled the first pending run and the targets built a full build apart.

**`all` for a request that needs two targets.** Correct artifacts, but every other target and both unsigned macOS variants also occupy runners and land in the same run's artifacts.

**A boolean input per target, each gating its matrix row.** Checkboxes read better than a typed list, but the matrix is built dynamically, so gating rows by input would move selection into eight duplicated row conditions, `plan` could no longer reject an empty selection, and the publish check would have to count the enabled rows.

## Consequences

- Targets named in one run build in parallel on their own runners, and their installers arrive as one run's artifacts.
- A misspelled target fails in `plan`, and the error message names the accepted ones.
- Two separate dispatches still serialize: the input removes the reason to split a build, not the queue rule.
- The input is free text, so an operator learns the accepted names from the input description, the workflow header, and `apps/desktop/README.md`.
