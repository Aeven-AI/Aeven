# Agent Note: coverage is a report, not a gate

Status: implemented

English | [中文](2026-11-06-coverage-is-a-report.zh.md)

## Problem

[The quality-gates decision](2026-06-11-quality-gates.md) set per-file 100% statement, branch, function, and line coverage on `packages/*/*/src`, and `vitest.config.ts` enforced it through `coverage.thresholds`. Since [pull-request gates moved to GitHub](2026-10-31-pull-request-gates-run-on-github.md), no CI job runs coverage, so the threshold failed only local `pnpm run test:coverage` runs. Repository instructions still called it the gating run, and agents spent turns adding tests to reach the bar for changes whose owning tests already passed.

## Decision

`vitest.config.ts` declares no coverage thresholds. `pnpm run test:coverage` and the partitioned run measure `packages/*/*/src`, print the text report, and list uncovered locations through `scripts/coverage-uncovered-locations.cjs`; neither fails on a percentage. The root and client `AGENTS.md`, `docs/testing.md`, and the pre-push checks skill describe coverage as a report.

`/* v8 ignore -- <reason> */` comments keep their reasons, so the report stays readable.

## Alternatives considered

**Keep the threshold and run coverage in CI.** The instrumented lane is the slowest in the matrix, which is why it left the per-push path.

**Keep the threshold local only.** A local-only bar that no merge requires is read as a requirement by agents and blocks no defect.

## Consequences

Evidence for a change is its owning tests, snapshots, and e2e runs. A coverage run is useful for finding dead code and untested branches, and its output is advisory.
