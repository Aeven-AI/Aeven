# Agent Note: A probe window serializes the Oxlint probes against compilers

Status: implemented

English | [中文](2026-09-22-a-probe-window-serializes-compilers.zh.md)

## Problem

`pnpm run check:all` failed in `build` while `test` ran beside it:

```
error TS6053: File '.../apps/cli/tests/profiles/headless/tests/oxlint-contract-69111ccb-....ts' not found.
  The file is in the program because:
    Matched by include pattern 'apps/cli/tests/**/*.ts' in 'tsconfig.host.json'
```

`scripts/oxlint-contract.spec.ts` proves which TypeScript project owns each file class by writing probes at the exact paths whose owning project it asserts, so the probes live inside the `include` patterns of the programs `tsc -b` builds. A program that reads such a directory while a probe exists and finds it gone by the time it reads the file fails with that error. The window is not incidental: a probe lives for the whole Oxlint invocation, and `run-gates` runs the `test` and `build` gates concurrently.

Reproduced on demand by deleting the probe at a fixed delay after `tsc -b tsconfig.host.json` started: 500 ms, 900 ms, 1700 ms and 2200 ms all failed with TS6053 (4 of 5 attempts); 1300 ms escaped because the directory read happened after the deletion.

Four configuration-shaped fixes were tried and each fails for a measured reason:

- `exclude` in `tsconfig.host.json`: Oxlint's project matcher honours `exclude`, so the probe resolves to `<none>` and the spec's own subject disappears (`Got tsconfig for file ...: <none>`, `Unmatched file`).
- A hidden dot-directory under the same parent: TypeScript's include matcher skips dot-directories, so the probe is invisible to the compiler and equally invisible to Oxlint's matcher.
- `tsc --excludeFiles` (TypeScript 6): it governs watch mode, not program membership — the probe was still compiled and still reported its own error.
- Naming the probe after an ignored pattern: the ignore patterns are what the spec's contract config clears, and they cannot separate one reader from another.

## Decision

One exclusive window, allocated by both sides. `scripts/transient-probe-window.ts` exposes `withTransientProbeWindow`, which reuses `@aeven/atomic-write`'s `withFileLock` (exclusive `wx` create, exponential backoff, bounded wait) and reaps a lock whose recorded process id is gone so a killed gate cannot block every later build. `scripts/run-tsc.ts` holds the same window for the whole compiler run, and `build:lib:host`, `build:lib:client` and `typecheck:contracts-ready` route through it. Every probe-writing case in the Oxlint contract spec now runs inside a window.

## Alternatives considered

Excluding the probes from the programs, in any of its four shapes, was measured and rejected in the Problem section: `exclude` removes the mapping the spec asserts, a hidden directory removes it from both matchers, `--excludeFiles` does not affect a program, and ignore patterns are what the contract config clears. Mirroring the configuration tree into a private root was also tried: Oxlint then resolves the aggregate projects as no-claim (`Got tsconfig for file ...: <none>`, `Unmatched file`), because the aggregate projections do not claim files outside the repository tree, so the spec would assert a copy's behaviour instead of the repository's.

Serializing the `test` and `build` gates in the scheduler would remove the overlap without touching the spec, but it costs the whole 200 s `test` gate on the critical path of every gate that depends on `build`, for one fixture. Retrying the build when it fails with only a probe-shaped TS6053 was rejected as masking: the probe's lifetime is the same in every run, so nothing about a second attempt is more likely to succeed beyond a coin flip.

## Consequences

- A compiler never reads a directory a probe is passing through, and a probe window never opens while a compiler runs. The cost is overlap, not work: a contender waits for the other side (measured compiler runs of 1.8 s, 2.0 s, 2.9 s and 3.3 s across window holds of 0.5 s, 0.9 s, 1.7 s and 2.2 s).
- The lock is `.avn-transient-probes.lock` at the repository root, gitignored like the probe files themselves. Both sides wait up to fifteen minutes, which is the compiler's own run time; the recorded pid is what makes an abandoned lock recoverable without an operator.
- The probes remain exactly where the contract needs them, so the spec still proves the real project mapping rather than a mirrored copy of it.
- `doc-typecheck` and `verify-node-next-types` build their own programs from doc extracts rather than the test trees, so they are not routed through the runner.
- Evidence: 4 of 5 bare runs failed with TS6053 and 0 of 5 failed with the window; `scripts/transient-probe-window.spec.ts` pins the lock's release, waiting, and dead-holder recovery, and `scripts/run-tsc.spec.ts` proves with a barrier that the compiler starts only after an open window closes.
