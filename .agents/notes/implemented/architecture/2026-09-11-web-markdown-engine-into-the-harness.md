# Agent Note: Absorb the web Markdown engine as a client package

Status: implemented

English | [中文](2026-09-11-web-markdown-engine-into-the-harness.zh.md)

## Problem

The web client's Markdown renderer lived in a separate repository and reached this one only as an installed npm dependency of `ui-primitives`. Nothing here could edit it: `MarkdownText` was an adapter over `@aeven-ai/hypermarkdown`, and every rendering question — a fence that re-rendered mid-stream, a gutter that remounted when a block closed, a stylesheet rule — was answered in the other repository and arrived here as a release.

That separation cost two specific things. The engine and its consumer changed together in practice but shipped apart, so `ui-primitives` was pinned to `0.4.2` while the engine's own repository was already at `0.4.4`, and the difference was invisible until someone compared them by hand. And an edit to the engine's source could not be seen in the running client at all: there was no source in the checkout to edit, so the inner loop began with a publish.

## Decision

The engine lands as `packages/client/hypermarkdown`, npm name `@deepseek-ai/dsh-client-hypermarkdown`, a statically linked client library with no Cordis surface — the same package mode as `ui-primitives`, `client/store`, and `client/ui-slots`. `ui-primitives` reaches it through a `workspace:^` devDependency and the `@aeven-ai` npm dependency is gone.

The move is a copy, not a fork. The source is the v0.4.4 tree verbatim, so the engine keeps its own idiom and stays diffable against its origin; the ported suite (62 spec files, 889 tests, 100% per-file coverage) came with it and is the regression net for every later edit.

### What the harness required that the standalone repository did not

Four things, and each is mechanical rather than behavioural.

Relative imports carry explicit `.ts`/`.tsx` extensions, and the upstream `lib/` directory is `src/engine/` here — `lib/` names build output in this repository, and the lint gate ignores that path outright.

The upstream entry split in two: `src/HyperMarkdown.tsx` holds the component and `src/index.ts` is the barrel. The config catalog and the library registry both key on `src/index.ts`, so a `.tsx`-only entry is not merely unconventional here, it is invisible to those gates.

The four plugin factories are exported from the package root instead of `plugins/*` subpaths, because a statically linked library reaches the compile shell through one root entry. The modules are unchanged, so each factory is still its own file and importing one still costs nothing.

The stylesheet is plain CSS with its nesting intact, not the upstream SCSS. The engine's SCSS used no Sass feature at all — no variables, mixins, or `@use` — so the port carries the authored file and lets the shell's lightningcss pipeline own it; the cost is that the sheet now needs a browser with CSS Nesting, which every engine this GUI runs on has.

Three upstream tests changed for reasons that are not mechanical. `tests/example/` was dropped: it covers the standalone repository's example application, which is not part of the component. The `"use client"` assertion was replaced by one on stylesheet ownership, because this repository's client bundles are closure factories loaded by the shell, not ES modules a framework's directive can address. And three DOM parity fixtures in `ui-primitives` were re-recorded for the engine's own `0.4.4` settle-render fix, which stops a finished block from carrying animation markers — a deliberate upstream behaviour change, reviewed as fixture diffs before recording.

### What the port decided not to conform to

The engine and its suite keep upstream idioms the repository's type-aware lint rules would otherwise rewrite: `prefer-const`, the `no-unsafe-*` family, `no-this-alias`, `no-non-null-assertion`, `no-unnecessary-condition`, `unbound-method`, and `no-deprecated`. The rules are off for this path alone, with the same justification `vendor/**` carries — a port stays diffable against its origin — and style, correctness, promise, and unused-code rules stay on. Two upstream constructs are explicitly protected by that override rather than "fixed": a duplicated settle branch whose branches are identical, and one regex literal longer than the column limit that cannot be wrapped without becoming a different regex. The duplication gate carries the same exemption for the same reason: every clone it finds in this repository sits inside the ported engine, and collapsing them would mean refactoring source this repository does not author.

## Consequences

The engine is now edited here, and a source edit reaches the browser through `pnpm run dev:web`: the script discovers it as a static library package by its build preset, watches `tsc`, its own tsdown bundle, and the shell's dist build. What that gives is a rebuild-and-reload loop, not an in-place plugin swap — a statically linked library has no runtime fiber to replace; only a `dsh.client` plugin reloads without a page reload.

`ui-primitives` was pinned to `0.4.2` and now consumes `0.4.4`, which is a behaviour change rather than only a version bump: a settled block renders through the plain shape, so its line numbers and markers carry no animation attributes. The three parity fixtures above record that.

The standalone repository's publish pipeline is no longer this repository's dependency, and its other consumers no longer receive engine changes from here. Keeping both live would reintroduce exactly the drift this change removes, so the standalone repository is expected to be retired rather than maintained in parallel; until it is, it is a fork in waiting.

The package is a publishable release member, not a private one: `ui-primitives` is published, so the engine it links must be too.

## Alternatives considered

**Keep the npm dependency and vendor a build.** Rejected. It preserves the drift — a version in this repository that trails a source in another — and leaves the engine uneditable in the checkout, which is the whole of the problem.

**Make the engine a `dsh.client` plugin so it hot-swaps in place.** Rejected. The engine is a React component library consumed as a value by `ui-primitives`; a feature plugin may not runtime-import another feature plugin's values, and the repository's own rules put shared runtime code in a narrow static owner, which is what `ui-primitives` is. The development experience is not worth an architecture that contradicts the layering it would live in.

**Flatten the SCSS to CSS at build time.** Rejected. It would add a Sass step to a build that has no other use for one, and it would put the generated sheet where maintainers edit — the opposite of a source-of-truth stylesheet. Native nesting costs one browser-support constraint that the local client already satisfies.
