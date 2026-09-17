---
description: "Shared React UI atoms for the avn web client: controls, icons, markdown and math rendering, and the terminal/read/diff/search/web output cards (zero cordis)."
kind: "package-library"
---

# @aeven/client-ui-primitives

English | [中文](README.zh.md)

## Summary

`avn-client-ui-primitives` is the web client's shared React component library: every feature plugin composes its UI from these atoms, and nothing here depends on Cordis or the slot system. It provides the control set (buttons, pills, inputs, menus, modals, toast banners, disclosure rows, hover cards, connection indicators), the icon glyphs and brand marks, positioning hooks for anchored overlays, and the content renderers for agent output: markdown with TeX math, terminal output, file reads, diffs, search results, web retrieval, and JSON inspection. The renderers are built for untrusted model output — raw HTML is dropped, links are neutralized or opened safely, and ANSI escape sequences are parsed rather than passed through. User-facing copy is supplied through label props; the feature plugin that composes an atom owns localization.

Controls, menus, modals, Markdown, and code blocks consume ui-theme's Aeven geometry and typography variables; this package's icon glyphs and brand marks remain unchanged.

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

Compose feature UI from these atoms whenever the web client needs a standard control or an agent-output renderer. They render through React only and take `--dsw-*` design tokens from the theme, so they fit any plugin without importing the theme or the slot system.

### Controls and icons

`Button`, `Pill`, `Input`, `Menu`, `Modal`, `Tooltip`, `DisclosureRow`, `StateDot`, `HoverCard`, `Toast`, `ConnectionIndicator`, `RiskConfirmation`, and the `OnboardingSurface` first-run takeover cover the common interaction shapes. The `ic_ds_*` icon set and `FishLogo`/`BrandWordmark` marks fill brand and inline-icon slots. `ConnectionIndicator` renders a warning-colored disconnected action, a connecting label whose one-to-three dots advance every 500ms independently of retry timing, or a success-colored recovered status. Every state reserves the widest supplied label and uses fixed icon and text columns, so copy changes do not move or resize the control. Its owner supplies visibility, the recovery hold, localized labels, and the immediate-reconnect callback; the primitive uses no native title tooltip. `useAnchoredPosition` and `useAnchoredMaxHeight` keep floating panels and bottom-anchored overlays clamped to the viewport and following their anchor. `HoverCard` keeps its portaled preview reachable across the anchor gap and can expose a copy button through the `copyText` prop. `Toast` holds for the window its owner names through `holdMs`, because how long a banner has to stay depends on how much there is to read; the same value drives its unmount timer and the stylesheet's fade delay, so the two cannot disagree. `rankByName` is the `/` menu's shared candidate ranker for the command and skill sources: the query must be a case-insensitive ordered subsequence of the name; prefix hits rank first, then alignment score, then source order ([ranking decision](../../../.agents/notes/implemented/feature/2026-08-04-web-slash-command-fuzzy-discovery.md)).

### Rendering agent output

`MarkdownText` renders untrusted GFM and TeX math through the [HyperMarkdown](../hypermarkdown/README.md) engine, blocks unsafe link and image schemes, and can turn resolved file mentions into explicit controls. Raw HTML is never parsed, so authored markup reaches the reader as characters rather than elements, and a ```` ```mermaid ```` fence renders as a diagram pinned to Mermaid's strict security level. While a reply streams the component writes only the appended text into the engine's store, which caches per code line, table row, and list item; finalization calls the engine's streaming finalize operation, whose external-store hook publishes and retains the final animated render. `TerminalBlock`, `ReadBlock`, `DiffBlock`, `SearchBlock`, and `WebBlock` render the matching tool-result intent with copy controls, overflow handling, and ANSI processing where applicable. `JsonTree` and `JsonBlock` inspect JSON values read-only, while `projectUserText` projects sent user text into inline plain runs and reference chips for the message bubble and queue rows.

KaTeX accepts a literal en dash in model-authored math without a compatibility warning; its other strict LaTeX diagnostics remain enabled.

### Localizing copy

The atoms cannot read the application locale, so every piece of user-facing copy arrives through required label props. `HoverCard`, `TerminalBlock`, `JsonTree`, `CodeBlock`, `MarkdownText`, `JsonBlock`, `ConnectionIndicator`, `Modal`, `DiffBlock`, `ReadBlock`, `SearchBlock`, and `WebBlock` accept complete localized labels. The package owns no language fallback; omission fails typechecking, and each feature maps its typed `t` seat into the primitive's label interface.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

The package is one separation: presentational React atoms with zero Cordis and zero slot knowledge, styled only through `--dsw-*` tokens, while every feature-specific concern (locale, session data, composition) stays in the composing plugin.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Public atom exports |
| [`src/markdown/`](src/markdown/) | Markdown and math pipeline: micromark parsing, KaTeX typesetting, incremental streaming renderer, `CodeBlock`/`JsonBlock` |
| [`src/TerminalBlock.tsx`](src/TerminalBlock.tsx) | ANSI escape parsing (`anser`) and terminal card rendering |
| [`src/ReadBlock.tsx`](src/ReadBlock.tsx) / [`src/DiffBlock.tsx`](src/DiffBlock.tsx) | Read and diff cards |
| [`src/SearchBlock.tsx`](src/SearchBlock.tsx) / [`src/WebBlock.tsx`](src/WebBlock.tsx) | Search and web-retrieval cards |
| [`src/icons/`](src/icons/) | `ic_ds_*` glyph components and brand marks |
| [`src/useAnchoredPosition.ts`](src/useAnchoredPosition.ts) / [`src/useAnchoredMaxHeight.ts`](src/useAnchoredMaxHeight.ts) | Floating-panel and overlay geometry hooks |

### Streaming markdown

While a reply streams, `MarkdownText` writes only the appended text into the engine's store and reseeds when the source is not an extension of what it applied last, which is what lets a transcript mount partway through a reply. The engine caches per code line, table row, and list item, so per-chunk work tracks the block currently growing rather than the whole reply — closed blocks cost nothing. When the reply finishes, the adapter calls `write(finalDelta, true)`. HyperMarkdown's external-store hook publishes that finalized render and leaves its animation spans mounted, so the last word fade completes without an adapter-owned timer or a second parse replacing the DOM.

### Geometry and overflow

The output cards share one geometry model: `white-space: pre` with horizontal scrolling so column-aligned content keeps its alignment, and a head-plus-tail slice behind an expand button past `maxLines` (default 16) so a long body never stretches the card. `TerminalBlock` parses ANSI into React spans with a per-line column buffer for cursor movement, honoring erase-in-line, tab stops, and character width.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

These pages place the atoms in the client stack and the design system.

- [ui-renderer](../ui-renderer/README.md) — the React renderer that mounts the assembled application and binds slot data.
- [ui-tool](../ui-tool/README.md) — the tool-call presentation layer that composes these output cards.
- [ui-conversation](../ui-conversation/README.md) — the chat surface that renders markdown replies and tool cards.
- [ui-theme](../ui-theme/README.md) — the `--dsw-*` token system these atoms style through.
- [Web styling](../../../docs/web-styling.md) — the authoritative styling rules for web client components.

-----

<a id="model-experience"></a>
## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>


These limits define how the atoms behave at the edges; they are current package constraints, not a component roadmap.

- **The renderer's own chrome is unlocalized and unthemed** — the markdown engine draws its table, diagram and code toolbars from its own English strings and `--hm-*` variables, so those controls do not follow the application locale or the `--dsw-*` theme. `MarkdownLabels.footnotes` is accepted but not applied for the same reason: the engine names that section itself.
- **Glyph-level icons are redrawn approximations** — the fish logo and the sparkle mark come from font glyphs whose vector geometry is not exportable from the local design data; hand-authored recreations stand in until an exact export path exists.
- **`Pill` and `Input` have no design source** — both atoms are self-defined; the sidebar search field and view-tab strip that resemble them are consumer-owned compositions, not these atoms.
- **No `Active` `StateDot` variant** — the supported states are done, warning, ongoing, and error.
- **User-facing copy is required at the render site** — the atoms are zero-Cordis and cannot reach `ctx.locale`; each feature must supply complete localized labels through the primitive's typed props ([decision](../../../.agents/notes/implemented/architecture/2026-08-23-locale-owned-client-ui-copy.md)).
- **`TerminalBlock` is not a terminal emulator** — it renders settled or still-running command output, not an interactive session: SGR colors, carriage return, backspace, erase-in-line, tab stops, and character width are honored; absolute cursor positioning, screen clearing, and alternate-screen sequences are stripped.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. Pure props-in React atoms with no Cordis API — no events, no services, no mutable cross-plugin state; rendering contracts are asserted directly by this package's component specs.
