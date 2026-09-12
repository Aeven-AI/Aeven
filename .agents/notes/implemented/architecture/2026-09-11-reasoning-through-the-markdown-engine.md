# Agent Note: The assistant's reasoning renders through the Markdown engine

Status: implemented

English | [中文](2026-09-11-reasoning-through-the-markdown-engine.zh.md)

## Problem

An Assistant step's prose rendered through HyperMarkdown and its reasoning did not. `AssistantMarkdown` gave `kind: 'text'` blocks to `MarkdownText`, the engine's adapter, and rendered `kind: 'reasoning'` blocks with `ReasoningRow`, a disclosure component of this package's own. A step therefore had one renderer per block, and the engine's entire reasoning pipeline — the `<think>`, `<thinking>` and `<reasoning>` block types, `patterns.reasoningOpenRegex`, `detectBlockType` checking for them first, `streamReasoning`, `splitReasoning` for the settled path, `controls.reasoning` for the wrapper — was fully implemented and completely unused by this client.

The cost was not only duplication. A long trace is exactly the block the engine's caches exist for, and it was not getting them; and two renderers for one step meant two answers to when thinking is over — `ReasoningRow` followed the tail of the block, the engine follows its own stream state.

This note is phase 1 of the integration that was scoped as a whole: making the engine the one renderer of everything a step says. The phases after it are named under Consequences.

## Decision

**A step's reasoning is written into the source as the engine's own reasoning block.** `AssistantMarkdown` composes the step's blocks into one accumulated markdown string: a `text` block is appended as it is, a `reasoning` block is wrapped by `reasoningSource`, and the engine renders the whole thing. `ReasoningRow` and its stylesheet are gone; `markdownLabels` now carries the block's two headers, so `thinking` and `thoughtFor` follow the application locale through the same label adapter the code-fence copy already used.

**A block stays open only as the step's last block.** `reasoningSource(text, open)` writes `<think>…` with no closing tag only while its reasoning is the final block of the source and the step is still streaming; anything after it — prose, an image, a tool head — closes it, because a trace that something else already follows is finished thinking. An open block is the engine's "still thinking": the reader sees the trace running while the model works and a collapsed block once it stops, which is the engine's own behaviour. `lastEngineBlock` is what makes "last" mean the source and not the step, so a trailing tool head — drawn by another node and never in the source — can neither keep a trace open nor leave one that nothing left in the source could close.

**A reasoning body cannot close its own block.** A body that contains a literal `</think>` would end the block early — the engine matches the tag after parsing, so no markdown escape reaches it. `defuseClosingTag` swaps that one `<` for its full-width twin, which reads the same and is not a tag. A body without the token is returned unchanged.

**A step still splits around what the engine cannot render.** An image gallery or an unrecognized block ends the run in progress and is emitted between runs, so the authored order survives; the tool-call heads are skipped here as before, because `ChatView`'s grouping pass draws them as their own nodes.

## Alternatives considered

**A typed-parts API on the engine (built, then reverted).** The first attempt added `Part`, `writeParts` on the component handle, and part bookkeeping inside `Renderer`, so a host could stream `{ kind: 'reasoning' | 'markdown', text }` without encoding the kind in the text. It worked for a single batch and failed the moment a step interleaved parts: the engine's incremental state machine infers a block's kind from its buffer, and a part boundary is a second document syntax competing with that inference. The boundary text leaked into the block it was meant to end, a part's successor could be typed as its predecessor, and the fixes cascaded through `streamMd`, `drainMd`, `streamProcess` and `streamReasoning` — six interacting places in a 900-test engine, for a client that is the engine's only consumer. Reverted whole. The engine's own tag protocol is a document syntax it already implements and tests, and using it cost five lines in the adapter.

**Keep `ReasoningRow` and give the engine a host-supplied reasoning component.** The engine would keep its pipeline and call this package's disclosure. It preserves the old chrome exactly, and it was rejected as the destination: the engine's reasoning block is the thing being adopted, and a wrapper the engine calls is the old component with more indirection. It remains the cheaper move if the app's own disclosure styling is ever wanted back.

**Serialize with custom tags and switch the engine out of `html: 'literal'`.** Rejected in the proposal and still rejected: it trades the guarantee that authored markup is never parsed for a rendering convenience.

**Feed the engine one part per block, sequentially.** A new block is a new full source, so a trace could not grow the way a reply does, and each chunk would re-render its whole block — the cost the engine exists to avoid.

## Testing

`engine-reasoning.client.spec.tsx` holds the new behaviour from the step's side: the engine draws the block, a settled one starts collapsed and opens on click, a running one stays open, authored order survives reasoning between prose, a step uses one engine instance for consecutive prose, a gallery splits it, and a tool-only step still renders nothing. `markdown.client.spec.tsx` holds the source contract: a wrapped body renders inside the engine and not beside it, `defuseClosingTag` leaves an ordinary body alone and touches only the closing tag, and the labels reach the header. `chat-font-axis-styles.client.spec.ts` reads the engine's reasoning block against the conversation's type scale through the Markdown host sheet that overrides it. The four existing specs that asserted `ReasoningRow`'s DOM — its running ring, its `data-state`, its latest-line summary, its `thinkBody` — were rewritten to assert the reader-visible behaviour instead, and the Turn-process folding tests now assert that a sealed fold holds a collapsed block rather than the trace's text.

## Consequences

Every reasoning block in an existing transcript now re-renders through the engine: the reader sees a collapsed block per trace instead of a Think row, and the trace's own duration comes from the engine's clock rather than from `ReasoningRow`'s position in the step. The 思考 / Think label is unchanged, and both headers are localized.

The engine's reasoning chrome is now the app's reasoning chrome, so restyling it means overriding the engine's `--hm-*` values from the Markdown host sheet — which `MarkdownText.module.css` already does for the block's type size, line height and colours. Its chevron and its collapsed/expanded geometry are the engine's.

Tool rows, images and the ordering between a step's nodes are unchanged and still outside the engine. That is the work left in the integration this note begins: tool rows render through the same engine as a block the host supplies, and a step's runs collapse into one region once they can. It is also why `AssistantMarkdown` still splits a step into runs.
