# Agent Note: Close the per-file 100% coverage gate by fixing what it finds

Status: implemented

## Problem

`pnpm run test:coverage` enforces `thresholds.perFile` at 100% statements, branches, functions, and lines ([vitest.config.ts](../../../vitest.config.ts)). On `83422f9ea5` the gate was red: 32 files across 11 package groups missed it, carrying 391 uncovered statements between them — 229 of those in a single file, `packages/experimental/browser-overlay/src/overlay.ts`.

Three remedies were available: write tests, add a reasoned `/* v8 ignore -- <reason> */`, or add an entry to the `coverage.exclude` list. The exclusion list already carries many `TODO(...)` entries whose stated trajectory is to shrink, so extending it would have moved the repository away from its own direction. This note records which remedy each gap took, because the choice is not uniform: an uncovered branch is a defect signal, and answering it wrongly — by excluding or by fabricating an input — hides the very thing the gate exists to surface.

The raw HTML report is not a reliable index of what fails. `istanbul-lib-coverage`'s `CoverageSummary.isEmpty()` tests only `lines.total === 0`, and `istanbul-reports` then forces all four displayed percentages to `0` for such a file. 138 files in this run displayed `0%` on all four metrics while passing the gate. Any triage that reads the report by eye must instead recompute each file's percentage from its `covered/total` cells.

## Decision

The remedy policy is **not** new here: [the quality-gates note](../process/2026-06-11-quality-gates.md) already sets per-file 100% on `packages/*/*/src` with reasoned `/* v8 ignore */` for unreachable defensive guards instead of deletion. This note records how one closure applied that policy, and the cases where applying it was not mechanical.

**Tests are the default remedy.** The great majority of the 32 files were closed with behaviour tests written against public seams — 47 for `bundle/web-app/src/sign-in.ts`, 38 for `overlay.ts`, 13 for the previously untested `llm/llm-aeven`, and so on.

**A reasoned `v8 ignore` is reserved for arms that are unreachable and cannot be removed.** It is used in exactly one file, `packages/experimental/browser-overlay/src/motion.ts`, for four records: two degenerate guards downstream of the `ARRIVAL_EPSILON_PX` early return (which already holds the distance they re-test), and two `T | undefined` narrowing guards in private methods whose sole call site has already tested the field. Each carries its reason on the directive line. The claim was independently recomputed from the source and falsified empirically — a 1,083-sequence sweep left all four cold — before the directive was written.

**When the unreachable arm is itself the defect, fix the defect.** `packages/llm/llm/src/error.ts`'s `ENTRIES_OVER_LIMIT` alternative read `too\s+many` with no trailing `\s+`, so it could only match the nonsensical `"too manyentries"` and never the wording its own docblock names. The two uncovered branches were the symptom; the missing quantifier was the disease. The quantifier is restored and the three alternates are pinned directly. This is the case that justifies the gate: excluding those branches would have buried a live error-classification bug.

**No new `coverage.exclude` entries, and no new thresholds.** `vitest.config.ts` is unchanged.

**Two adjacent defects found by the same run are repaired only where they blocked the gate.** A redundant narrowing guard in `sign-in.ts` was deleted rather than ignored, because a one-line destructuring removes the need for it. Package registration and the four remaining product defects are listed under Consequences.

## Alternatives considered

**Growing `coverage.exclude`.** Rejected: the list's own entries carry the intent to shrink, and an exclusion is invisible to the next reader of the source file.

**A bare `v8 ignore` on every awkward arm.** Rejected by repository convention (`packages/client/AGENTS.md`: "Genuinely unreachable defensive arms take a `/* v8 ignore -- <reason> */` comment with a real reason, never a bare ignore"), and rejected here for the `error.ts` case outright, where the arm's unreachability was the bug.

**Fabricating impossible states with test doubles to reach defensive arms.** Used by one workstream and accepted only provisionally. Six records in `computer-use` tasks/benchmark were reached by holding `String.prototype.split` at `[]`, by making `JSON.parse` throw a non-`Error`, and by a `node:fs` module double — none of which any real input produces. Each is restored in a `finally`, and the package does have in-repo precedent, but the technique asserts a state the code cannot be handed, so it tests the double rather than the producer. These six are the outstanding item: the consistent remedy is a reasoned `v8 ignore` on the arm, as in `motion.ts`. The risk they illustrate is the one the quality-gates note already names — that 100%-coverage pressure yields tests asserting only that a double ran — for which [mutation testing](../../proposed/testing/2026-06-11-mutation-testing.md) is the planned counterweight.

**Re-running the whole instrumented suite per workstream.** Rejected: a narrowed `--coverage.include` runs in seconds and is the right inner loop, but it is conservative, not authoritative — a file covered only by another package's suite reads as uncovered in isolation. Only the merged partitioned run is a verdict.

## Consequences

**Concurrent coverage runs must not share a reports directory.** Vitest cleans its reports directory at the start of every run, so two instrumented runs against the same default `coverage/` path destroy each other's output and produce failures that look like real ones. Several workstreams lost runs to this before it was identified. Parallel work must pass a distinct `--coverage.reportsDirectory`.

**`packages/llm/llm-aeven` is now registered in `tsconfig.host.json`.** It was absent from both aggregates — invisible while the package had no tests, because nothing pulled it into the program. Its first test file made the aggregate's `packages/*/*/tests/**/*.ts` glob import `src/index.ts` from a project that no reference covered, producing TS6307. Registering the package clears it; `tsc -p tsconfig.host.json` now reports no errors.

**Five product defects were found and are deliberately not fixed here.** Each changes observable behaviour and needs its own change with an Agent Note and snapshot, not a patch inside a coverage task:

1. `signIn()` in `packages/bundle/web-app/src/sign-in.ts` never settles when the loopback listener fails to bind. `startCallbackListener` builds `origin` with a `resolve` only, so the server's `error` handler rejects `callback` while `origin` stays pending, and `signIn` awaits `origin` first. A taken port, `EMFILE`, or `EPERM` produces a hang rather than an error, and the `finally { listener.close() }` is never reached.
2. `computer-use-windows` `readiness()` ignores `WindowsAdapterOptions.powershell`: all three probes in `src/readiness.ts` hardcode `'powershell'`, so an adapter configured with `powershell: 'pwsh'` reports readiness for an executable it does not drive.
3. `file.exists` rejects instead of reporting false. `@aeven/computer-use-router` and the executor's `filesystemHandler` let `ENOENT` escape `stat`, though the recipe reads "Report whether a path exists".
4. `AttachOptions.glideDurationMs` in `packages/experimental/browser-overlay/src/overlay.ts` is stored by the constructor and `attach()` and never read, so its documented "Zero disables the glide and snaps instead" behaviour does not exist.
5. `ENTRIES_OVER_LIMIT` — fixed here, because it blocked the gate; see Decision.

**Verification.** `AVN_COVERAGE_PARTITIONS=6 pnpm run test:coverage:partitioned` exits 0 against `972ec24a79` with no threshold `ERROR` lines and no uncovered-location records. Cache the exit code by redirecting to a file: piping the command to `tail` reports the pager's status, which masked a genuinely failing run during this work.
