# The recorded-session replay left CI

## Problem

`build-verify` ran the recorded-session replay as `{ ...snapshotGate(['build']), allowFailure: true }`. A gate with `allowFailure` prints `NON-BLOCKING FAILED` and the job still concludes success, so run 41340242556 reported green while nine scenarios inside it failed. The comment above that line said why: several fixtures predate the working-directory prompt section and need a keyed `test:snapshot:record` that nobody had run.

The result was a gate that could not say no. It reported the same verdict for a broken replay and a working one, so the drift it detected — eleven scenarios broken by a reviewer-prompt change in the same week — reached `main` unnoticed.

## Decision

The replay is not a CI gate. `ciBuildVerifyGates()` returns the build and the artifact gates only, `ci-snapshot` is gone from the mode list, `check:ci:snapshot` is gone from `package.json`, and `webSnapshotGate`'s ordering no longer waits for it. `pnpm run test:snapshot` still runs the suite from a working tree for anyone who wants to compare a prompt change against the recorded corpus.

A gate earns its place by failing when the thing it checks is broken. One that reports `NON-BLOCKING FAILED` and exits zero is worse than absent: it spends the run's minutes and produces evidence that reads as a pass.

## Alternatives

**Make it blocking and re-record the fixtures.** That is the honest version of this check, and it was rejected for now because the corpus needs a DeepSeek key and hand-authored replacements for the scenarios that record mode skips. It can come back that way when someone owns that re-record.

**Fix the eleven stale fixtures without touching the gate.** It repairs today's drift and leaves the mechanism that hides the next one.

## Consequences

A replay regression no longer reaches `main` invisibly — because the replay no longer runs there at all. Nothing else in the pull-request lane changed: the unit suite, typecheck, build and artifact gates still decide whether a change lands.

`ciWindowsCompleteGates()` keeps its `allowFailure` mapping. Those are observational Windows gates, named as such, and they stay visible without blocking; this decision is about a gate that claimed to check something and could not fail.
