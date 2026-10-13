# Agent Note: Close the documentation gates the computer-use stack left red

Status: implemented

English | [中文](2026-09-22-documentation-gates-after-computer-use.zh.md)

## Problem

`pnpm run doc-sync` was red on `main`, on four gates, all of it shipped by one change (`9421149a37 Add the self-contained computer-use stack and browser overlay`) and unaddressed since:

- **`verify-doc-graphs` did not fail — it crashed.** The stack publishes a second Cordis service, `computerUseProvider` (the macOS adapter's provider object, declared by module augmentation). The graph generator classifies every discovered service in `scripts/gen-doc-graphs.ts` and refuses to render while any is unclassified, so no graph doc could be checked at all.
- **`verify-export-jsdoc`: 65 exported names undocumented** — 53 of them in `packages/experimental/browser-overlay` (`motion.ts`, `springs.ts`, `styles.ts`), the rest across eight `computer-use` packages.
- **`doc-typecheck`: 27 README code blocks that do not compile** — examples referring to names the block never declares (`startedAt`, `router`, `handlers`, `runner`, …), almost all in `packages/computer-use/*/README.md`.
- **`verify-type-equiv`: two subsystems pages drifted** from the sources they mirror (`CompactionTrigger` carried a one-line JSDoc where the source has four, and `ResolvedCredential`'s source list had gained `session`).

A fifth problem hid inside those counts. A lint-contract spec writes a probe into a package's `src` to prove the aggregate lint configuration catches it, and removes it again; a killed run leaves one behind, and a scan running *beside* that spec can enumerate a probe that is gone by the time it reads it. That is what made `scripts/gen-client-catalog.spec.ts` fail with `ENOENT`, and it is what made one `verify-export-jsdoc` line name `client/ui-primitives` — a package with no undocumented export at all.

## Decision

Each problem is fixed at its owner, and nothing is silenced:

- **`computerUseProvider` is classified, not hidden.** It gets a `SERVICE_ROLES` entry with `mode: 'core'`, `pkg: 'computer-use'` (matching where `scripts/gen-cordis-catalog.ts` already attributes it) and `implementations: ['computer-use-macos-provider']`, so `gen-doc-graphs` renders again and `docs/capability-seams.md` gains its node, its two edges, and its table row.
- **Every undocumented export is documented**, describing what the function or property is and what a caller may rely on. Constants that carried a shared comment across two declarators got one block each, because each is now a documented unit.
- **README examples are made to compile** rather than opted out. The fenced blocks of a README are byte-identical across its English and Chinese sides, so each edit is applied to both sides and the pair re-recorded.
- **The two drifted subsystem pages are brought to their sources**: the JSDoc and the source-layer list, on both language sides.
- **The transient probe leaves the slot scan's corpus.** `scripts/slot-walk.ts` filters `oxlint-contract-<id>.ts(x)` from both of its scans, with the reason recorded at the filter and the same name the per-file coverage gate already excludes. `scripts/slot-walk.spec.ts` covers the boundary: a probe is skipped, a real declaration is indexed, and a name that merely resembles a probe (`oxlint-contracts.ts`) is indexed.
- **One pre-change excerpt is marked as an excerpt.** The boot-gate note quotes the `if (await this.gateOnAuthentication()) { … return }` it replaced, which cannot compile standalone; its fence takes the repository's `ts ignore-check` idiom used by other notes for the same purpose.

## Alternatives considered

**Opt the failing README blocks out with `ignore-check`.** Fastest, and rejected: the corpus already ignores 45% of its blocks against a 50% guard, and the opt-out is meant for excerpts that cannot compile, not for examples that are simply wrong. Every block in this change compiled after its example was completed.

**Delete the README examples instead.** They teach the packages' composition, which is the material a reader of a new stack needs most. The examples were incompletely transcribed, not wrong in kind.

**Leave the probe exclusion to the coverage gate.** That gate already excludes the name, which is why the residue was invisible there; the slot scan and the export-jsdoc scan read the same directory without the same guard. Excluding it where the corpus is enumerated fixes both readers at once.

**Retire `computerUseProvider` rather than document it.** The service has no production consumer today — only its adapter's tests address it — so the repository rule that ties each abstraction to a current consumer would eventually ask for it. That is a decision about shipped behavior with a real consumer question behind it, and a documentation gate is not the place to make it; the classification records what is true now.

## Consequences

`pnpm run doc-sync` is green: 32 gates pass, `verify-export-jsdoc` documents every exported name, `doc-typecheck` compiles 102 blocks, `verify-doc-graphs` renders all six graph docs, and `verify-type-equiv` matches 404 blocks against their sources.

The two scans in `slot-walk.ts` now skip a name pattern, so a corpus that should contain a real `oxlint-contract-*` declaration would not be indexed. That name is reserved by the lint-contract spec for a probe it deletes in the same run, and the coverage gate treats it the same way.

Nothing here changed runtime behavior: the diff outside documentation is JSDoc, one `SERVICE_ROLES` entry, and the scan filter.

## Testing

`scripts/slot-walk.spec.ts` owns a temporary root and covers the three cases above, which is the boundary the filter moved. The evidence for the rest is the gates themselves, run on the final tree: `verify-export-jsdoc`, `doc-typecheck`, `verify-doc-graphs`, `verify-type-equiv`, `verify-translation-pairing` (1239 pairs consistent), `verify-md-links`, and the package suites of both touched packages (`browser-overlay` 90 tests, `computer-use` suites).
