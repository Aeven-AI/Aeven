---
description: "The streaming-native Markdown engine that renders assistant output in the avn web client: it caches settled blocks down to code lines, table rows and list items so a growing reply never re-parses finished work."
kind: "package-reference"
---

# @aeven/client-hypermarkdown

English | [中文](README.zh.md)

## Summary

`avn-client-hypermarkdown` is the Markdown engine behind the web client's transcript. It renders untrusted GFM, TeX math, syntax-highlighted fences and Mermaid diagrams, and it is built for text that arrives in pieces: a block that has settled is never parsed again, so a reply that grows to thousands of lines keeps paying only for the part that changed. The renderer caches per code line, table row, and list item, reconciles streamed output against a full parse at every step, and publishes the finished render through its own external store so word-fade animation survives finalization.

[`MarkdownText`](../ui-primitives/src/markdown/MarkdownText.tsx) in `ui-primitives` is the only consumer inside this repository and owns the untrusted-output policy: raw HTML is never parsed, unsafe link and image schemes are blocked, and Mermaid runs at its strict security level. This package owns the engine itself — the parser pipeline, the streaming caches, the block repair pass, the toolbar chrome, and the stylesheet it renders with.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the component, attach the plugins the surface needs, and drive streaming through the imperative handle. The heavy engines are opt-in: a slot left empty degrades instead of failing, so `$x$` stays literal, a fence renders unhighlighted, and a ```` ```mermaid ```` fence renders as a code block. A ```` ```message ```` fence holds text the reader will send on — a message, email, or reply — and renders as wrapped prose in the surrounding text's font, with a copy button and no line numbers; its title and copy label are the `message` and `copyMessage` translations.

```tsx
import { HyperMarkdown, katexPlugin, highlightPlugin, mermaidPlugin } from '@aeven/client-hypermarkdown'

const plugins = {
  math: katexPlugin(),
  code: highlightPlugin(),
  diagram: mermaidPlugin({ securityLevel: 'strict' }),
}

<HyperMarkdown
  ref={handle}
  streaming
  animation
  html="literal"
  plugins={plugins}
  translations={labels}
  components={components}
/>
```

While a reply streams, call `handle.write(chunk, false)` for each frame and `handle.write('', true)` once to finalize; `handle.reset()` starts a new document. `md` renders a complete document in one pass instead. Importing a plugin factory never loads the library behind it — Mermaid and the fence highlighter resolve theirs on first use.

Mermaid diagrams offer zoom controls and pointer panning by default. An ordinary wheel zooms a fullscreen diagram; inline diagrams require Ctrl, Command, or a trackpad pinch so ordinary wheel input continues scrolling the transcript. Set `controls.diagram.panZoom` to `false` to disable these interactions.

The package imports its own stylesheet, so a consumer that renders the component needs no separate import of one. `katex/dist/katex.min.css` and `tippy.js/dist/tippy.css` stay the host's, because KaTeX and Tippy are optional peers the host installs.

## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### The streaming contract

Source is applied to a mutable per-instance store; `md` is a pure function of the accumulated text. The two are reconciled by tracking what the store has already been told, so a transcript may mount partway through a reply: the component writes only the append while the new text extends what it applied last, and reseeds when it does not.

When accumulated text is replaced during a stream, `replaceStream` clears the old parser state and seeds the replacement before notifying subscribers, so the renderer does not publish an empty document between the two.

A block boundary is scanned rather than guessed, and everything before the last complete boundary is settled: code lines re-render through a line-level cache, table rows and list items through their own. `engine/repair/**` normalizes the syntax models actually emit — unterminated emphasis, math delimiters split across chunks, task-list markers, setext headings, table shapes — before the unified pipeline sees it, which is what keeps a half-written reply from painting markup it will drop a frame later. A table row is one that opens with its own pipe, so a shell pipeline, a regex alternation or a `||` inside a bullet stays prose whatever it carries ([why](../../../.agents/notes/implemented/bug-fix/2026-09-28-table-repair-leading-pipe.md)).

### What the engine owns

| Area | Source |
|---|---|
| Streaming caches | `src/engine/cache/**` |
| Boundary scan and stream state | `src/engine/stream/**`, `src/engine/line-index.ts` |
| Markdown repair | `src/engine/repair/**` |
| Parser pipeline and sanitization | `src/engine/processors.ts`, `src/engine/sanitize.ts` |
| Fence, table, diagram and reasoning chrome | `src/engine/code/**`, `src/engine/table/**`, `src/engine/mermaid/**`, `src/engine/reasoning/**` |
| Image row grouping | `src/engine/rehype/image-group.ts` |
| Inline video players | `src/engine/rehype/video-embed.ts`, `src/engine/video.tsx`, `src/engine/video-url.ts` |
| Plugin factories | `src/engine/plugins/**` |
| Stylesheet | `src/styles/hypermarkdown.css` |

### Styling

The engine draws its own chrome from `--hm-*` custom properties declared on `.hypermarkdown`. The stylesheet is plain CSS with native nesting and travels with the bundle: the build's static-linked preset emits it beside the JavaScript and keeps the relative import, so the shell's CSS pipeline owns class hashing and delivery.

Table cells wrap at a maximum width of 32ch; tables wider than their container scroll horizontally. Inline code uses `--hm-size-small`, 1px by 6px padding, a 16px radius, and a `#f2f2f2` background.

A run of two or more images written on consecutive blocks becomes one `div.markdown-image-grid` carrying `data-count`, and a lone image keeps the block it was written as. Grouping is structure only: the shape, radius and fit of a tile, and the row's own geometry, stay with the host, which already owns every rule for a rendered image. A loaded image carries `data-orientation` (`portrait` or `landscape`) so a host can shape each tile to its image.

A paragraph that holds only YouTube or Vimeo links becomes a player per link, and each run of them is one `div.markdown-video-grid` carrying `data-count`, a lone video included. A video linked inside prose keeps its link, and the paragraph or list item that mentions it is followed by a player for it. While a reply streams, a run of image or video lines stays one open block until the paragraph after it arrives, so the run renders as one row. A player shows the video's poster under a play button and loads the provider's frame only when the reader presses it: YouTube from `youtube-nocookie.com`, Vimeo with `dnt=1`, with the frame address rebuilt from the video's id rather than taken from the link. Every tile is 3:2, poster and player alike; Vimeo's poster comes from its oEmbed lookup. Until its poster loads, a tile shows the same `.image-loader` surface an image does and carries `data-loaded` once it has. The engine draws the tile and its button, and the run's geometry stays with the host. The button's accessible name comes from the `playVideo` and `playVideoUntitled` translations, and its glyph from `icons.play`.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Web Client](../../../docs/subsystems/web-client.md) — how a client library reaches the browser through the compile shell.
- [ui-primitives](../ui-primitives/README.md) — the consumer, and the package that owns the untrusted-output policy for this engine.

-----

<a id="model-experience"></a>
## Model Experience

None, as the engine renders assistant output in the browser and contributes nothing to the request that produced it.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits are current constraints of the ported engine, not a component roadmap.

- **The engine's own chrome is unlocalized and unthemed** — the table, diagram and fence toolbars draw from the engine's own English strings and `--hm-*` variables, so those controls follow neither the application locale nor the `--dsw-*` theme. A host supplies its own copy for footnote headings and copy controls through `translations`.
- **The stylesheet requires native CSS nesting** — the port ships the upstream SCSS as plain CSS with its nesting intact rather than flattening it at build time (this repository has no Sass step), so the sheet needs a browser with CSS Nesting: Chrome 120+, Safari 17.2+, or Firefox 117+.
- **KaTeX and Tippy stylesheets stay the host's** — neither dependency is inlined into this package's sheet, so a host that renders math or a toolbar must import `katex/dist/katex.min.css` and `tippy.js/dist/tippy.css` itself. Without them the content still renders; math loses its fonts and tooltips lose positioning.
- **No browser-grade rendering lane** — the suite drives the engine through jsdom and static markup, so layout, paint, and scrolling behavior of the toolbar chrome is verified only by the shell's own end-to-end web tests.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This package is a port, not a fork: it was copied verbatim from the standalone `@aeven-ai/hypermarkdown` repository (v0.4.4) so that its source is editable here and its changes reach the web client through this repository's build instead of an npm release. Three mechanical differences follow from the move and are the only intended divergence:

- relative imports carry explicit `.ts` extensions, and the upstream `lib/` directory is `src/engine/` here (`lib/` names build output in this repository);
- the upstream `src/index.tsx` became `src/index.ts` (barrel) plus `src/HyperMarkdown.tsx` (component), because the config catalog and the library-registry gate both key on `src/index.ts`;
- the four plugin factories are exported from the package root rather than through `plugins/*` subpaths, because a static-linked library reaches the shell through one root entry. The modules themselves are unchanged, so each factory is still its own file.

The engine's own suite moved with it and runs offline: 62 spec files under `tests/`, split by boundary into `unit/`, `correctness/`, `streaming/`, `ui/`, `api/`, `plugins/`, `security/`, and `coverage/` (the last one pinning the defensive branches the engine keeps on purpose). Everything under `tests/` is the upstream suite renamed to this repository's `*.client.spec.*` convention; only the example-app spec was dropped, because `example/` is not part of the component.

</details>

**Runtime invariant:** No companion is published. The engine is pure props-in React and has no Cordis API — no events, no services, no mutable cross-plugin state; its contracts are asserted directly by this package's own specs.
