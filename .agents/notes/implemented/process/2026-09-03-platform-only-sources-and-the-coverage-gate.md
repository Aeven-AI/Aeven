# Agent Note: A platform-only source is its own module so other hosts can run the coverage gate

Status: implemented

English | [中文](2026-09-03-platform-only-sources-and-the-coverage-gate.zh.md)

## Problem

The per-file 100% coverage gate could not pass on macOS, on a clean tree, for any branch.

`readProcessStart` reads field 22 of `/proc/<pid>/stat`, which exists only on Linux. On Darwin the function returns at its `process.platform !== 'linux'` guard, so the five statements below it never execute. Those five were the only uncovered statements in the repository — 53,569 of 53,574 — and they held `packages/experimental/code-runtime-python/src/index.ts` at 99.15%, failing the threshold and exiting 1.

CI never saw it: the coverage lanes are Linux and Windows, and Windows excludes that package outright because its tests need bash and Python. `vitest.config.ts` already carried the same machinery in the opposite direction — `windowsOnlyCoverageExclusions` drops win32-only sources when the lane is not Windows — so the Linux direction was an omission rather than a decision. The effect was that a maintainer running `pnpm run test:coverage` before a push read a failure their change did not cause, which is how a gate stops being read at all.

## Decision

**A source whose body executes on exactly one platform lives in its own module, and `vitest.config.ts` excludes that module from coverage on every other platform.**

`readProcessStart` moved to `packages/experimental/code-runtime-python/src/process-start.ts`, and `linuxOnlyCoverageExclusions` drops that path when `process.platform !== 'linux'`. `src/index.ts` re-exports the function, so the package's public surface and its callers are unchanged.

The module is the unit because the module is what vitest's coverage `exclude` accepts. Widening the existing `v8 ignore` to span the read would suppress those lines on the Linux lane too, where `tests/runtime-budgets.spec.ts` genuinely covers them — that trades an enforced gate for local convenience.

## Consequences

`pnpm run test:coverage` now passes on Darwin on a clean tree, so the gate is usable as a local pre-push check on all three development platforms.

On a non-Linux host the whole of `process-start.ts` goes unmeasured, including the Darwin arm that does run there. That arm is a single `return undefined`, asserted by `runtime-budgets.spec.ts`'s non-Linux branch, so what is lost is a coverage number and not a test.

The exclusion pattern now runs in both directions, and a third platform-specific source belongs in its own module rather than under a broad ignore comment. The cost of the rule is a module per such source; that is the price of keeping the surrounding file under the full bar.

`readProcessStart` stays exported from the package entry. A future reader looking for it in `index.ts` finds the re-export and the comment pointing at the split.

## Verification

`pnpm run test:coverage` on Darwin, before and after, is the evidence this note rests on. Before: 53,569/53,574 statements, one file below threshold, exit 1. After: 100% statements, branches, functions, and lines, exit 0.

The package's own suite is unchanged at 283 passed and 2 skipped, which is what shows the move is behavior-preserving. `pnpm run typecheck`, `pnpm run lint`, and the 15 documentation gates pass.

The Linux lane is unaffected by construction: `linuxOnlyCoverageExclusions` is empty when `process.platform === 'linux'`, so the file stays under the per-file bar exactly where its lines are reachable.

## Alternatives considered

**Exclude `src/index.ts` on non-Linux hosts.** Rejected: over 2,000 lines that macOS does cover would leave the gate, which is a far larger hole than the one being closed.

**Widen the `v8 ignore` comment to span the `/proc` read.** Rejected: the comment is static, so it would blind the Linux lane as well and retire real coverage of the field-22 parse.

**Add a macOS coverage lane to CI.** Rejected: a macOS lane cannot reach these lines either, so it would need this same exclusion before it could pass. It is a reason to keep the rule, not an alternative to it.

**Inject the file reader so a Darwin test can drive the parse.** Rejected: it adds a parameter to a teardown-path probe purely to serve a coverage number, and it would verify the parse against a fixture rather than against a real `/proc` entry, which is the part worth testing.
