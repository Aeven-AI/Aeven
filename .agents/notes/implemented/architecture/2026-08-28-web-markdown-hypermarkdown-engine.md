# Agent Note: Assistant markdown renders through the HyperMarkdown engine

Status: implemented

English | [中文](2026-08-28-web-markdown-hypermarkdown-engine.zh.md)

The finalization decision in this note is superseded by [HyperMarkdown owns streaming finalization](../bug-fix/2026-09-08-hypermarkdown-streaming-finalization.md). The engine and accumulated-string adapter decisions remain current.

## Problem

The [direct mdast renderer](2026-08-06-web-markdown-incremental-ast-renderer.md) bounded streaming cost at the block: it froze settled blocks and re-parsed only the source tail. That is the right bound for a reply made of many small blocks and the wrong one for a reply made of few large ones, which is what assistant output usually is. A 120-row table, a 150-item list, and a 500-line fence are each a *single* block, so each arriving chunk re-parsed and re-rendered the whole thing, and the frontier block's cost still grew with the reply.

Closing that needs caching below the block — per code line, per table row, per list item — plus the streaming policy decisions that come with partial syntax: when a half-written fence, table row, or formula may be shown and when it must be withheld. That is a renderer, not a component, and the repository had begun to own one.

## Decision

**`MarkdownText` is an adapter over `@aeven-ai/hypermarkdown`, and the repository owns no markdown renderer.** The component's props are unchanged, so all eight call sites are untouched; what it owns is the policy it passes and the `code` component it supplies.

**The adapter converts an accumulated string into the engine's deltas.** The engine takes writes into a mutable store, while this component's contract is a pure function of the whole text, so the adapter records what the store was last told and writes only the append — reseeding from scratch when the new text is not an extension of it, which is what lets a transcript mount partway through a reply. Writes happen in an effect, never in the render body: the store mutates in place, so a render React discards would corrupt it.

**Finalize runs the settled parse rather than flushing the stream.** Streamed output is chunk-dependent for fences and tables; the one-shot settled parse is not. Running it at the swap makes the settled DOM identical however the reply arrived, which is the property the parity fixtures assert and the property a reader rereading a finished transcript depends on.

**Raw HTML is never parsed.** `html: 'literal'` means authored markup reaches the reader as characters, so no schema gap in a sanitizer can promote it to elements. Link and image destinations pass a scheme allowlist (`http`, `https`, `mailto`); relative destinations are permitted because they resolve against this app's own origin and refusing them would make a relative asset unshowable. Mermaid diagrams render pinned to Mermaid's strict security level, code-split and preloaded at mount.

`parse.ts` stays for `extractMarkdownPlainText`, which still parses through it for the compact trajectory projection, and so does the CJK micromark extension it uses. The math grammar does not: the engine carries its own math plugin, which left `parseGfmWithMath` and `mathCompatibility.ts` without a caller, so both are gone along with the three micromark math dependencies only they needed. `CodeBlock` and the shiki highlighter stay for `ReadBlock`, `run_code`, and the other tool cards, which are not markdown.

## Testing

`tests/fixtures/markdown-dom` continues to pin the DOM, now recorded from the engine: a fixture diff is a user-visible markdown change to review, never to re-record for a refactor. `markdown-dom-parity.client.spec.tsx` asserts the settled DOM is chunk-independent by replaying each fixture at several chunk sizes, and `markdown.client.spec.tsx` holds the policy: raw HTML inert, unsafe schemes dropped, relative destinations kept, and the inline-code affordances the component supplies.

## Alternatives considered

**Extend the direct mdast renderer with sub-block caching.** The renderer already existed and its parity fixtures already passed, so the change would have been additive. Rejected on what it would have grown into: caching below the block means owning partial-syntax policy for fences, tables, lists, and math, plus the invalidation that goes with each — a renderer's worth of decisions, maintained for one consumer, against a dependency that already makes them.

**Keep both renderers and select per reply.** Rejected: the selection would key on a guess about the reply's shape made before the reply exists, and two renderers means two DOM contracts, two security policies, and fixtures that must agree.

**Take the engine's streaming finalize (`write(…, true)`) instead of re-running the settled parse.** It is one call rather than a reseed, and it keeps the stream's caches. Rejected on measurement: streamed output differs by chunk size for fences and tables, so the finished transcript would depend on how the reply happened to arrive over the network.

## Consequences

Streaming cost is measured against the renderer it replaces (production React, separate process, median of three runs, 8-char chunks): 19x on a 120-row table, 8.8x on a 150-item list, 8x on a 500-line fence, and no change on paragraphs. Sub-block caching pays wherever one block grows long; closed blocks were already cheap in both.

The renderer's own chrome is unlocalized and unthemed. The engine draws its table, diagram, and code toolbars from its own English strings and `--hm-*` variables, so those controls follow neither the application locale nor the `--dsw-*` theme, and `MarkdownLabels.footnotes` is accepted but not applied because the engine names that section itself. This is the cost of not owning the renderer, and closing it means settings the engine does not yet expose.

Markdown behavior is now a dependency's, so a rendering defect is fixed upstream and shipped as a release. Two are open and pinned as known gaps in `markdown.client.spec.tsx`: an anchor receives `target="_blank"` whatever its scheme, so `mailto:` leaves a blank tab behind; and a destination's scheme is compared case-sensitively before it is canonicalized, so a valid `HTTPS://` link is dropped.

The [incremental renderer note](2026-08-06-web-markdown-incremental-ast-renderer.md) records the decision this replaces. Its GFM grammar survives in `parse.ts`; its settled math grammar, incremental parser, mdast walker, and KaTeX bridge do not.
