# Agent Note: Highlight.js for Tool Cards

Status: implemented

English | [中文](2026-09-02-highlight-js-tool-cards.zh.md)

## Problem

Assistant markdown fences already highlight through HyperMarkdown's highlight.js plugin, while `CodeBlock` and `ReadBlock` used a second engine (shiki) that Vite modulepreloaded as a ~394 kB boot chunk plus a tree of lazy grammars. First paint paid for both highlighters.

## Decision

`packages/client/ui-primitives/src/markdown/highlight.ts` uses `highlight.js/lib/core` with four boot languages (javascript, typescript, bash, json). The read-card language set loads on first use through `highlight.js/lib/languages/*`. `CodeBlock` and `ReadBlock` consume that module; MarkdownText keeps HyperMarkdown's highlight.js plugin (rehype-highlight → lowlight/common). ui-theme's `highlight.css` colors `hljs-*` classes with the same token palette the shiki sheet used. Vite emits highlight.js core, lowlight, and lowlight/common grammars as the `hljs` boot chunk; CodeBlock's dynamic language imports resolve to that same file.

## Verification

Unit tests cover alias resolution, lazy language load, viewport activation, streaming line retention, and ReadBlock per-line runs. The built-artifact test requires an `hljs-` boot file, forbids a `shiki-` boot file, and still requires katex, mdast, and on-demand mermaid chunks. The streaming-fence Chromium scenario asserts `code.hljs` in the HyperMarkdown fence.

## Alternatives considered

**Keep shiki for tool cards.** That preserves incremental TextMate state and `--shiki-*` inline colors at the cost of a second engine on every boot.

**Drive tool cards through HyperMarkdown's rehype plugin.** The plugin highlights one fence line via a hast tree and does not expose per-line runs for a guttered read card.

## Consequences

Boot no longer downloads shiki. Markdown fences and tool cards share highlight.js. Streaming `CodeBlock` re-highlights the accumulated text (no TextMate grammar state) and reuses completed line span arrays when the new highlight matches. Unknown languages stay plain.
