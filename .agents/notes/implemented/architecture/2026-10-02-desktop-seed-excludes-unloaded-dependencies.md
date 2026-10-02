# Agent Note: The Desktop seed excludes dependencies the Host never loads

Status: implemented

English | [中文](2026-10-02-desktop-seed-excludes-unloaded-dependencies.zh.md)

## Problem

The Desktop application carries an offline seed of the complete production dependency graph ([packaging Agent Note](2026-08-25-electron-desktop-packaging-and-updates.md)). A measured Linux x64 build was 1,254 MB unpacked, of which the seed was 840 MB; per-target seed installs on the same lockfile measured 475–575 MB for macOS and Windows. Three causes carried no runtime value.

`onnxruntime-node` was in the reviewed `allowBuilds` policy for MemOS. Its install script builds nothing: on Linux x64 it downloads about 205 MB of CUDA and TensorRT execution providers from nuget.org, and on every other target it does nothing. The seed's offline verification install ran it, pnpm recorded the 317 MB result as a side effect in the store index, and the seed shipped it. The "offline" first-launch installation also depended on nuget.org. MemOS's embedder requests `device: "cpu"`, so nothing loads those providers.

The pnpm graph installs every declared `dependencies` edge, including the browser libraries of `@aeven/client-ui-primitives` (mermaid, cytoscape, KaTeX, highlight.js, react-dom), Lexical in `@aeven/client-ui-conversation`, and xterm in `@aeven/client-ui-sidebar-terminal`: about 73 MB on every target. The Host never imports them. The web frontend `dist` compiles in `@aeven/client-ui-primitives` with its fonts and stylesheets, plugin `lib/client.js` bundles contain their own Lexical copy, and xterm resolves from the browser module table that `dist` supplies. The library packages still declare these edges because their published `lib/index.js` is consumed by bundlers.

MemOS's dependency graph added two more copies. `@memtensor/memos-local-plugin` depends on `tsx`, and through it `esbuild` (11–12 MB), only to respawn its standalone Hermes/OpenClaw bridge daemon from `bridge.cts`; the seed prune already deletes that source, so the route cannot run in Desktop. `@huggingface/transformers` requests `sharp@^0.34.5` beside the attachment reader's `^0.35.3`, which installed a second libvips (17–20 MB). Transformers.js imports `sharp` when it loads but decodes no images for text embeddings.

## Decision

The generated Desktop workspace file ([`project-manager.ts`](../../../../apps/desktop/src/project-manager.ts)) denies the `onnxruntime-node` build, and the repository `pnpm-workspace.yaml` applies the same policy. MemOS embeds on the CPU runtime the package ships.

`DESKTOP_DEPENDENCY_OVERRIDES` adds pnpm `overrides` to every Desktop workspace file. A `parent>child: "-"` entry removes one edge, and pnpm keeps a package any other edge still reaches, so a library that a Host package also declares stays installed. The overrides remove every dependency edge of `@aeven/client-ui-primitives`, the Lexical edges of `@aeven/client-ui-conversation`, the xterm edges of `@aeven/client-ui-sidebar-terminal`, and MemOS's `tsx` edge. `@huggingface/transformers>sharp` resolves to the attachment reader's `sharp` range. A Desktop unit test fails when an overridden first-party edge disappears from its workspace manifest, when `@aeven/client-ui-primitives` gains a dependency the overrides do not remove, or when the `sharp` ranges diverge.

Overrides are written into the workspace file rather than applied as store pruning, so the lockfile, the offline installation proof, macOS seed signing, and `integrity.json` all describe the reduced graph. The startup check that compares an installed profile's workspace file with the release's expected file covers them unchanged.

## Alternatives considered

**Prune the browser libraries' files from the seed store.** The existing per-package prune rules pin exact versions, but the seed resolves its own lockfile and these libraries float within their ranges, so a pinned rule would fail the build on every upstream release. Store pruning would also leave the packages in the lockfile and graph.

**Move the browser libraries to `devDependencies`.** This changes what npm publishes for `@aeven/client-ui-primitives`, whose `lib/index.js` imports them for third-party bundlers. The Desktop graph is the only consumer that never loads them.

**Download Office, OCR, and MemOS engines on first use.** This would save another 280–430 MB per target. Rejected for now: a first-use download blocks the feature on a large transfer and needs progress, failure, and retry UI, as the [bundled Office reader note](2026-09-29-bundled-office-reader.md) records, and MemOS must work from a clean installation.

## Consequences

Measured Linux x64: the seed dropped from 840 MB to 427 MB and the unpacked application from 1,254 MB to 840 MB. A clean `AVN_HOME` booted the packaged application under Xvfb, installed the seed offline with no network download, passed the staged health check with MemOS reaching `pipeline.ready`, and rendered the sign-in page. A Transformers.js feature-extraction run from the installed seed on the bundled Node.js produced 384-dimensional MiniLM embeddings on the CPU runtime with `sharp` 0.35.5. The other targets were measured by installing the same lockfile with pnpm `supportedArchitectures` set to each target and applying the release prune rules; macOS arm64 dropped from 515 MB to 405 MB.

A Desktop plugin that depends on one of the overridden first-party packages gets the same reduced edges. Plugins ship prebuilt client bundles, so this matches what their Host half can load. A Host package that starts importing one of the removed libraries must declare it; pnpm then keeps the package through that edge.
