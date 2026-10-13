# Agent Note: Web Client Render Chunks

Status: implemented

English | [中文](2026-09-02-web-client-render-chunks.zh.md)

## Problem

The Web shell's Vite graph statically imports ui-primitives, so KaTeX, the highlighter, and the markdown parse pipeline share one `vendor` chunk that every session downloads before first paint. Mermaid is already a dynamic `import()` from the diagram plugin, but MarkdownText set HyperMarkdown's `preload` flag, which fetched that engine on every markdown mount, and the async mermaid files used rollup's default names mixed with the boot assets.

## Decision

`apps/web/vite.config.ts` emits three React-free render-family chunks — `katex`, `hljs` (highlight.js core, lowlight, and lowlight/common grammars), and `mdast` (micromark/mdast) — instead of one vendor file. The parse-pipeline chunk is named `mdast` so it cannot collide with a highlight.js language whose rollup name is `markdown`; every `micromark`, `micromark-*`, and `mdast-util-*` package joins that chunk so partial package assignment cannot create a circular shared chunk. Mermaid stays unlisted in `manualChunks` so rollup keeps its diagram engines as async chunks; `chunkFileNames` names those `m-core-*` and `m-asset-*`, matching the Aeven client layout. highlight.js language files are unassigned in `manualChunks`; HyperMarkdown's lowlight/common static-imports still place those grammars in `hljs`. MarkdownText does not set `preload`; the plugin's `load()` starts the mermaid fetch when a diagram fence actually renders.

## Verification

The built-artifact test requires `katex-`, `hljs-`, and `mdast-` boot files, rejects a separate `syntax-` chunk, requires at least one `m-core-` and `m-asset-` file, rejects `vendor-` and `shiki-` tokens in boot files, and rejects modulepreload of mermaid or `langs/` chunks. Markdown unit tests still render a mermaid fence as a diagram container.

## Alternatives considered

**Keep one vendor chunk.** A KaTeX or highlight.js bump then rehashes the entire render payload, and the 500 kB Vite warning fires on a boot file every session downloads.

**Put mermaid in `manualChunks`.** Rollup would fold the dynamic `import()` back onto a named boot chunk and restore mermaid to the initial graph.

**Keep `preload` on MarkdownText.** Every assistant message would start the mermaid download even when the turn contains no diagram.

## Consequences

Boot downloads katex, hljs, and mdast as separate hashed files, so each family caches independently. Sessions without a mermaid fence never fetch `m-core` / `m-asset`. Vite reports unexpected chunk growth above 700 kB; its largest sub-700 kB files are lazy Mermaid diagram engines rather than boot payloads.
