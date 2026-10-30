# Agent Note: Windows seed dependency consolidation

Status: implemented

English | [??](2026-10-30-host-dependency-bundles.zh.md)

## Problem

A profiled restart of installed Windows arm64 Desktop 0.3.28-alpha takes 63.7 seconds before its backend serves HTTP. Before readiness, about 30 seconds occur in file opens, 13 seconds in synchronous reads, and 5 seconds in package metadata reads. Most stacks load JavaScript modules.

## Decision

Windows seed preparation consolidates reviewed CommonJS dependency packages before recording the precomputed profile layout. [The build helper](../../../../apps/desktop/scripts/bundle-seed-dependencies.ts) retains each original module path as a facade over one shared package implementation. This preserves class identity across consumers and deep imports. CommonJS export metadata preserves Node's named ESM imports. Package-relative execution is rejected before replacement; native modules and OTel's platform-loaded resources remain unchanged.

Reviewed ES module packages take the same treatment through `bundleSeedEsmPackage`. Every original `.mjs` path keeps its name as the entry facade the bundler emits, so deep imports resolve and one shared chunk carries the implementation. `typebox` and `@sinclair/typebox` are reviewed at `build` and `build/esm`; a package that reads `import.meta`, `createRequire`, or `require` is rejected rather than rewritten.

Electron also starts the backend with `NODE_COMPILE_CACHE` under `$AVN_HOME/runtime/compile-cache`, so a later launch reuses V8 bytecode for the same module graph instead of parsing it again. The directory is version-scoped by Node.js itself; a corrupt entry is recompiled, not fatal.

Generated files replace directory entries by rename, never overwrite pnpm's hard-linked content objects. The existing layout generator hashes every facade and shared chunk into the seed store. Runtime installation requires no compiler. Plugin package operations can recreate ordinary dependency files; those remain functional without consolidation.

## Alternatives considered

**Embed copies in consuming plugins.** This risks duplicated classes and shared state, and does not consolidate the same dependencies used by vendored modules.

**Bundle every package.** Native binaries, package-relative resources, and ESM evaluation order need separate qualification. The reviewed CommonJS list limits this change.

**Disable Windows scanning.** File-open latency does not establish which scanner contributes, and changing machine security settings is outside application packaging.

## Consequences

The isolated installed-app benchmark reduces loaded scripts from 3,091 to 2,867. Cached startup timings remain variable and do not establish a wall-clock speedup. The original 63.7-second profiled run is not comparable to those cached runs.

A later measurement of the same installed profile attributes boot cost to the module graph rather than to session state: the Host reaches its advertised URL in 11.1 seconds with 2,817 sessions and a 598 MB search index present, while module loads account for about 3,500 script loads of which `typebox` and `@sinclair/typebox` contribute about 1,160. Importing the `typebox` entries that the Host loads falls from 370-666 loaded modules and about 750 ms to 2 modules and 95-425 ms after consolidation. Booting the same profile with a warm `NODE_COMPILE_CACHE` falls from 4.95-5.99 seconds to 3.82-4.39 seconds.

Artifact tests compare named exports before and after consolidation, exercise YAML errors and cross-module class identity, export telemetry records, prove fewer loaded modules, and verify that original store objects remain unchanged. The ES module spec proves a barrel collapses to one shared chunk with class identity intact and rejects package-relative execution. The [seed dependency decision](../architecture/2026-10-02-desktop-seed-excludes-unloaded-dependencies.md) and [precomputed layout decision](../bug-fix/2026-10-29-windows-precomputed-profile-layout.md) retain their independent installation rationale.
