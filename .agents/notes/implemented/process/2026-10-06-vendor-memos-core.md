# Agent Note: Vendor the MemOS core as source

Status: implemented

English | [中文](2026-10-06-vendor-memos-core.zh.md)

## Problem

`@aeven/memory-memos` runs the MemOS core in the Host, and Aeven changes that core's capture and retrieval behavior: summary attribution, the operation name on Host LLM calls, vector candidate limits, and keyword noise. A pnpm patch can change only the published files, and the MemOS package publishes compiled `dist/` beside its TypeScript sources, so a patch to `dist/` leaves the readable sources describing code that does not run, cannot be typechecked, and must be rewritten against new compiled output on every upgrade. The coming per-account memory split also needs changes in the core that are larger than a patch should carry.

## Decision

The MemOS core is vendored at `vendor/memos-local-plugin/` as `@deepseek-ai/memos-local-plugin`, pinned to upstream release tag `memos-local-plugin-v2.0.20` (MemTensor/MemOS commit `1c5e895be455`). Its `src/` holds upstream's `core/`, `agent-contract/`, and `server/` trees; `viewer/dist/` is the prebuilt Viewer from the matching npm package. Aeven's changes are edits to those sources, logged in [vendor/README.md](../../../../vendor/README.md#local-modifications), and the pnpm patch and its `patchedDependencies` entry are gone.

The package compiles under the repository's TypeScript project graph with the vendored-package relaxations and builds with a package-local tsdown configuration that keeps the module tree (`unbundle`) and copies the SQL migrations beside the compiled migrator, because MemOS locates its migrations relative to `storage/migrator.js` and `@aeven/memory-memos` imports individual modules such as `@deepseek-ai/memos-local-plugin/core/index.js`. Source-plane graphs resolve those subpaths through the `tsconfig.base.json` `paths` entry to `src/`.

The vendored copy omits what Aeven never loads: the stdio bridge and its `tsx` daemon launcher, the OpenClaw and Hermes adapters, install scripts, tests, templates, and `telemetry.credentials.json`. Aeven passes no telemetry instance to the core, so no credentials file was ever read. Its dependencies are the five packages the copied trees import.

## Alternatives considered

**Keep the pnpm patch.** It costs nothing to set up, but it edits compiled output that no compiler checks, and every change and upgrade is a hand-edit of generated JavaScript.

**Patch the shipped TypeScript sources alongside `dist/`.** The two copies would have to stay identical by hand, and the runtime would still execute the compiled copy.

**A GitHub fork consumed as a git dependency.** It moves changes into a second repository and release flow, and the Desktop seed would need to install a git dependency offline; a workspace package is packed with the other first-party packages.

**Vendor the whole npm package, including `dist/` and the adapters.** The adapters import agent hosts that are not dependencies here and would not compile, and keeping `dist/` would leave a second, untracked copy of the code.

## Consequences

Changes to MemOS are ordinary reviewed source edits that typecheck with the rest of the repository, and compiling the sources reproduces the code that ran under the patch byte for byte. Upstream fixes now arrive only through the sync procedure in `vendor/README.md`, which recopies the three trees from a release tag and re-applies the logged modifications. The Viewer stays a prebuilt artifact until its Preact source is vendored and built here. The MemOS manifest declares MIT while the MemOS repository root carries an Apache-2.0 `LICENSE`; the notices record both.
