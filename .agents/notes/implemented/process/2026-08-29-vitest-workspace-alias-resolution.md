# Agent Note: Vitest resolves workspace specifiers through aliases

Status: implemented

English | [中文](2026-08-29-vitest-workspace-alias-resolution.zh.md)

## Problem

Every Vitest config pointed `vite-tsconfig-paths` at `tsconfig.base.json` to resolve `@deepseek-ai/*` specifiers to `src`. Vite now performs tsconfig path resolution itself, so the plugin duplicated the bundler, and it worked only because that file declares no `include`: the plugin reads an include-less project as match-all. The repository depended on an absence, which is why `tsconfig.base.json` carried a standing prohibition on ever gaining `include` or `files`.

Switching the plugin for `resolve.tsconfigPaths: true` reads as the same resolution and is not, on two counts, both measured against the suites in `packages/api/session-controller`, `packages/api/workspace-controller`, and `packages/session-query/session-log-export`.

Native resolution matches a file against the nearest project rather than one match-all facade, so five test-only imports that no package declared stopped resolving at all — `dsh-system-prompt`, `dsh-jobs-local`, and `dsh-commands` in session-controller, `dsh-storage` in workspace-controller, and `cordis-plugin-include` in session-log-export. The match-all facade had been supplying them; nothing else ever had.

Native tsconfig paths also run *after* package resolution, not before it. A workspace specifier therefore resolves through the pnpm symlink and the package's own `exports` whenever built output exists, and `paths` never gets a turn. `@aeven/typert-protocol` loaded from `packages/typert/protocol/lib/index.js` beside the same module's `src`, so two copies of every class and service singleton existed at once: 48 tests failed on `instanceof` across the pair, and typed failures degraded to `'internal'` because the branch that recognizes them missed.

## Decision

**`workspaceAliases()` in `vitest.shared.ts` is the resolver, and every Vitest config sets `resolve: { alias: workspaceAliases() }`.** An alias is the only form that wins over a package's `exports`; the artifact-plane leak the `paths` map exists to close is not a thing native resolution can be configured out of. Each project inside `vitest.config.ts` repeats the option, because a project's `resolve` does not inherit the root's.

**The alias map is generated from `tsconfig.base.json`, never hand-kept.** That file is the one config in the repository declaring `paths`, so its 524 entries are the whole of what a test file may resolve, and a second copy would drift from the generator that writes the first. Each entry becomes an anchored pattern matching exactly what TypeScript matches — `^key$` for a literal key, `^prefix(.*)suffix$` for a wildcard one — and exact patterns are ordered ahead of wildcards, because Vite takes the first alias that matches while TypeScript prefers the more specific key.

**An import a test file makes is a dependency its package declares.** The five undeclared specifiers are now `devDependencies` at `workspace:^`. They were always dependencies; only the facade's breadth hid that, and a resolver that hides a missing declaration is a resolver that decides when the repository finds out.

## Testing

The three suites the regression was measured in run 507 tests green, against 496 with 8 failing on the tree this replaced. The full unit suite finishes with the 8 pre-existing `subagent-claude-code` real-product failures that reproduce identically on a pristine checkout, and nothing else attributable to resolution.

Module identity is asserted directly rather than through a resolver probe: `import.meta.resolve` answers from Node's resolver and reports `lib` regardless, so a test importing one export by package specifier and by relative source path and asserting the two are the same value is what distinguishes one copy from two.

## Alternatives considered

**Keep `resolve.tsconfigPaths: true` beneath the aliases.** Rejected: with a complete alias map the native option never resolves anything, and a second resolver that always loses is a second source of truth for a reader to reconcile. Precedence is the entire subject of this note; leaving a silent loser in the config obscures it.

**Add a `source` export condition to every package and order conditions ahead of `import`.** This resolves to `src` through package resolution itself, needing no alias map, and the shipped `exports` would carry the answer. Rejected: it edits 200-plus package manifests to state for tooling what `paths` already states, and a condition that resolves to TypeScript source is a face published to every consumer, not a test-lane setting.

**Revert to `vite-tsconfig-paths`.** Rejected: the plugin's correctness rests on `tsconfig.base.json` never gaining an `include`, an invariant no gate enforces and a reader has no reason to expect. The alias map does not care what the file's `include` says, and the prohibition survives only for the compiler projects that extend it, where it means what it appears to mean.

## Consequences

`tsconfig.base.json` stops being a resolution facade and becomes an ordinary compiler config that a build step reads. Its comment no longer warns about match-all scope, and the two Agent Notes describing the old resolver — [explicit workspace path aliases](2026-08-27-explicit-workspace-path-aliases.md) and [the two-aggregate solution root](2026-07-22-tsconfig-solution-root-two-aggregates.md) — name the alias map instead.

Adding a package still requires `pnpm run gen-tsconfig-paths`, and now that generated map is what the test lanes resolve through: a package missing from it resolves to built `lib/` under the test lanes exactly as it does under `tsc`, so the coverage assertion that gate already makes covers this too.

The repository owns 50 lines of resolver where it owned a dependency. The trade is deliberate: the code is small, its behavior is stated in one place, and it settles a precedence question the dependency answered by accident.
