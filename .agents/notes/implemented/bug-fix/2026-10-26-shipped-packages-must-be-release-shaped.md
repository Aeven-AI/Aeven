# Agent Note: Shipped packages must be release-shaped

Status: implemented

English | [中文](2026-10-26-shipped-packages-must-be-release-shaped.zh.md)

## Problem

The desktop release of 0.3.17-alpha failed in every target after a complete build, at the step that assembles the package set: `@aeven/base requires unpacked internal package @aeven/tool-worktrees`. `@aeven/worktrees` and `@aeven/tool-worktrees`, added to `packages/session/` earlier the same day, were `private: true`, exported `./src/index.ts`, and had no README, while `@aeven/base` depends on both. [`scripts/release/families.ts`](../../../../scripts/release/families.ts) skips private packages when it forms the `avn` publish set, so `release:pack --family avn` never produced their tarballs, and [`apps/desktop/scripts/prepare-package-set.ts`](../../../../apps/desktop/scripts/prepare-package-set.ts) refuses a closure with an unpacked `@aeven/` dependency. No check objected when the packages merged or when the version was bumped.

## Decision

Every package under `packages/` outside `packages/experimental/` belongs to the `avn` release family, so a package that ships must be release-shaped: no `private: true`, `publishConfig.access: public`, `repository.directory`, `main`, `types`, and `exports` pointing at `lib/`, a `files` list of the built artifacts, `license`, and a bilingual README triad. [`@aeven/worktrees`](../../../../packages/session/worktrees/package.json) and [`@aeven/tool-worktrees`](../../../../packages/session/tool-worktrees/package.json) now carry that shape, matching [`@aeven/tool-working-directory`](../../../../packages/session/tool-working-directory/package.json) from the working-directory feature that shipped beside them.

A private package is unreleasable by construction, so a package a shipped bundle depends on cannot be private: the desktop package set requires every `@aeven/` dependency of the closure to arrive as a tarball, and the release family skips private members. `packages/experimental/` stays private because releases exclude it entirely.

## Alternatives considered

**Keep the two packages private and fold them into the bundle.** This avoids publishing two small packages, but a bundle's patch layer names plugin packages by package name, so the Loader would still need to resolve them from somewhere, and folding them into `@aeven/base` would make one package own worktree code that the working-directory pair keeps separate.

**Relax the desktop closure check to skip unpacked `@aeven/` dependencies.** The check is what turns a missing tarball into a named error instead of a desktop application that fails at run time, so relaxing it moves the failure from the release log to a user's machine.

**Add a gate that rejects private or source-entry packages in CI.** This is the durable prevention, and it is deferred rather than rejected: the gate needs the release family's own membership rule to stay the single source, and [`scripts/release/families.spec.ts`](../../../../scripts/release/families.spec.ts) already reads it.

## Consequences

The release is currently the first place a non-release-shaped package surfaces, and it surfaces after the full build of every target. Until a gate covers it, adding a package means checking it against its nearest shipped sibling rather than against the experimental packages, which are private by design.

The two packages now publish `lib/` entry points, so the workspace's own tests and the source-launch path keep resolving `./src/index.ts` through tsconfig paths while npm consumers receive built JavaScript. Their READMEs state the model-visible tool text and the reasons neither publishes an `./invariant` companion.
