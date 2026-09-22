# Agent Note: No shared chunk, and no publication warnings

Status: implemented

English | [中文](2026-09-22-no-chunk-no-publication-warnings.zh.md)

## Problem

`publint` and `verify-built-package-invariants` were red, and `publint` also printed a warning per package.

`packages/workspace/workspace` was the one package out of thirty-nine invariant companions whose root and companion entries shared runtime code: both reach `kindPathAgrees` and the `WorkspaceId` cast, which pull the schema module the root entry builds its domain spec with. Bundled together, the build split that module into `lib/src-<hash>.js`, so `lib/index.js` and `lib/invariant.js` shipped with an import of a file `files` does not publish:

```
packages/workspace/workspace/lib/index.js:1 imports "./src-i6LT6W5D.js", but @aeven/workspace does not publish "lib/src-i6LT6W5D.js"
verify-built-package-invariants: Cannot find module '.../.aeven-built-invariant-*/lib/src-i6LT6W5D.js'
```

Separately, every package reports `pkg.exports["./src/*"] is ./src/* but does not match any files.` — 268 lines in one run. The verdict is not fatal, but it is printed for every package, so a run's output carries one line of noise per package before any real message.

## Decision

`packages/workspace/workspace/tsdown.config.ts` builds the root and its companion as two independent bundles, the shape `packages/core/scope` and `packages/core/agent-loop` already use. Nothing is shared between them at build time, so nothing is split out, and the payload stays exactly the two entries `files` names. The duplicated code is a pure predicate and a pure cast, so an inlined copy per bundle carries no identity that has to stay shared.

`scripts/publint-all.ts` drops exactly that one verdict for exactly the `./src/*` export key, the way it already drops the browser-bundle CJS-interop verdict. Any other glob export that matches nothing, and any other verdict on `./src/*`, stays reported.

## Alternatives considered

Publishing the chunk would suit the payload (`lib/types/**/*.js` is already published) but not `files` or the `constraints` gate, both of which pin the two entry files exactly — changing that is a repository-level policy decision, and the chunk exists only for this package. Duplicating `kindPathAgrees` and the id cast inside the companion was rejected because the invariant would then check a rule it no longer shares with the code it observes. Removing `./src/*` from every manifest and rewriting out-of-package test imports was rejected because that subpath is the stated way for a spec outside its package to reach internals.

## Consequences

- `pnpm run publint`, `pnpm run verify-built-package-invariants` and `pnpm run constraints` all exit zero, and publint's output no longer carries a per-package warning line.
- `packages/workspace/workspace/lib/` holds exactly `index.js`, `invariant.js` and `lib/types`; `pnpm run check:all` now reports no failing gate.
- The gate's spec pins both sides of the filter: the `./src/*` verdict is absent from the output, and another glob export that matches nothing is still reported.
