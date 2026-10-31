# Agent Note: Pull-request gates run on GitHub

Status: implemented

English | [中文](2026-10-31-pull-request-gates-run-on-github.zh.md)

## Problem

The `main` ruleset required a pull request and refused direct pushes, deletion, and force pushes, but it required no status check, so a pull request could merge with a failing typecheck, a repository-wide lint error, a stale recorded snapshot, or a package that does not build. `scripts/run-gates.ts` already defines a lane for each of those, yet nothing executed one on a pull request: the matrix ran only when a contributor chose to run it, and the hooks deliberately stop at staged lint, staged whitespace, the vendor manifest, and a push-time typecheck.

## Decision

- **`.github/workflows/ci.yml` runs three lanes** on every pull request into `main`, every merge-queue entry, and manual dispatch, one job each with Node 24: `static` and `types-lint` on `ubuntu-latest`, and `build-verify` on `macos-latest`.
- **`build-verify` builds the workspace once** and then runs everything that reads the output: `publint`, the NodeNext consumer types, the built-package invariants, and the keyless recorded-session replay. The replay reads this platform's sandbox and process-tree behavior, which is why that job is macOS.
- **The `main` ruleset requires the three job names** — `static`, `types-lint`, `build-verify` — beside the pull-request, deletion, and non-fast-forward rules.
- **Coverage stays local.** `pnpm run test:coverage` remains the repository's gating coverage run, off the per-push path: per-file 100% under instrumentation is the slowest lane in the matrix, and a lane that fails on runner capacity teaches contributors to ignore the check.
- **The remaining lanes stay local**: `check:ci:consumers` (Node 22.19/24/26 compatibility, browser web snapshots, doc typecheck), the Windows lanes, `pnpm run test:e2e` (needs `DEEPSEEK_API_KEY`, which fork pull requests never receive), and every documentation gate, which is advisory by policy.
- **Duplication and the snapshot replay report without blocking.** Six clones are open on `main` across the per-package `sync.ts` modules, and several headless fixtures predate the working-directory prompt section; both need a shared helper or a keyed `test:snapshot:record` before they can gate a merge, and `ci-primary` still fails on them.
- **The documentation gates run in one process.** `pnpm run doc-gates` executes the workspace constraints and the Markdown wrap check from one Node process inside the `static` lane, instead of one `pnpm run` subprocess each.
- **No `paths:` filters.** A required check that a filter skips never reports, and an unreported required check blocks the merge.

## Alternatives considered

**Requiring `check:ci:primary` as one job.** It contains most of these gates already, but one check name hides which lane failed and serialises the matrix into a single job whose elapsed time is the sum of its gates.

**Requiring coverage.** It is the documented gating run, and it would catch an uncovered line before merge; declined because the instrumented pass is the heaviest gate, and a slow required check is the first thing a contributor learns to distrust.

**Running the matrix nightly on `main` instead of per pull request.** Far cheaper, but the report arrives after the regression has merged, which is the state this decision removes. A nightly stays available for the excluded lanes.

**Narrowing each pull request with `scripts/check-changed.ts`.** Required checks must report on every pull request, and a narrowed run reports green for the gates it filtered out.

## Consequences

- One `build-verify` job builds the workspace once for both the publish surface and the snapshot replay; two jobs would build it twice and cost a second full compile per pull request.
- A merge now waits for three checks, so an unstable one blocks the queue. `concurrency` cancels a superseded push run and exempts a merge-queue batch, which a pull-request push must not cancel.
- Coverage, the Node compatibility matrix, browser snapshots, and the Windows lanes remain evidence someone runs by hand: `main` can carry an uncovered line until a contributor or a diagnosing agent runs `check:all`.
- The three job names are ruleset identifiers. A renamed job leaves every open pull request waiting on a context that never reports.
- The workflow's own pull request is its first evidence: the three jobs report on this change before the ruleset requires them.
