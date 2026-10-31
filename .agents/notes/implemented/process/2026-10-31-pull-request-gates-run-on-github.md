# Agent Note: Pull-request gates run on GitHub

Status: implemented

English | [中文](2026-10-31-pull-request-gates-run-on-github.zh.md)

## Problem

The `main` ruleset required a pull request and refused direct pushes, deletion, and force pushes, but it required no status check, so a pull request could merge with a failing typecheck, a repository-wide lint error, a stale recorded snapshot, or a package that does not build. `scripts/run-gates.ts` already defines a lane for each of those, yet nothing executed one on a pull request: the matrix ran only when a contributor chose to run it, and the hooks deliberately stop at staged lint, staged whitespace, the vendor manifest, and a push-time typecheck.

## Decision

- **`.github/workflows/ci.yml` runs four lanes** on every pull request into `main`, every merge-queue entry, and manual dispatch, one job each on `ubuntu-latest` with Node 24: `pnpm run check:ci:static`; `pnpm run typecheck` followed by `pnpm run check:ci:lint:contracts-ready`; `pnpm run check:ci:snapshot`; and `pnpm run check:ci:artifacts`.
- **The `main` ruleset requires the four job names** — `static`, `types-lint`, `snapshot`, `artifacts` — beside the pull-request, deletion, and non-fast-forward rules.
- **Coverage stays local.** `pnpm run test:coverage` remains the repository's gating coverage run, off the per-push path: per-file 100% under instrumentation is the slowest lane in the matrix, and a lane that fails on runner capacity teaches contributors to ignore the check.
- **The remaining lanes stay local**: `check:ci:consumers` (Node 22.19/24/26 compatibility, browser web snapshots, doc typecheck), the Windows lanes, `pnpm run test:e2e` (needs `DEEPSEEK_API_KEY`, which fork pull requests never receive), and every documentation gate, which is advisory by policy.
- **No `paths:` filters.** A required check that a filter skips never reports, and an unreported required check blocks the merge.

## Alternatives considered

**Requiring `check:ci:primary` as one job.** It contains most of these gates already, but one check name hides which lane failed and serialises the matrix into a single job whose elapsed time is the sum of its gates.

**Requiring coverage.** It is the documented gating run, and it would catch an uncovered line before merge; declined because the instrumented pass is the heaviest gate, and a slow required check is the first thing a contributor learns to distrust.

**Running the matrix nightly on `main` instead of per pull request.** Far cheaper, but the report arrives after the regression has merged, which is the state this decision removes. A nightly stays available for the excluded lanes.

**Narrowing each pull request with `scripts/check-changed.ts`.** Required checks must report on every pull request, and a narrowed run reports green for the gates it filtered out.

## Consequences

- Every pull request costs four Linux jobs. `snapshot` and `artifacts` each build the workspace, so that build runs twice; one combined job would halve it and lose a check name that names one concern.
- A merge now waits for four checks, so an unstable one blocks the queue. `concurrency` cancels a superseded push run and exempts a merge-queue batch, which a pull-request push must not cancel.
- Coverage, the Node compatibility matrix, browser snapshots, and the Windows lanes remain evidence someone runs by hand: `main` can carry an uncovered line until a contributor or a diagnosing agent runs `check:all`.
- The four job names are ruleset identifiers. A renamed job leaves every open pull request waiting on a context that never reports.
- The workflow's own pull request is its first evidence: the four jobs report on this change before the ruleset requires them.
