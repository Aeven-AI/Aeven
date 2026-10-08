# Agent Note: Generated images at their tool calls

Status: implemented

English | [中文](2026-10-02-generated-images-at-tool-calls.zh.md)

## Problem

Generated images inside a tool card disappear when the Turn process is collapsed. The reader sees no generation placeholder, and an assistant restating the image can create another copy or make display depend on a later model response.

## Decision

Imagine registers atomic views for `generate_image`, `codex_image_generate`, `codex_image_edit` and `grok_imagine_image`. The existing tool-call node owns the prompt, running/result state and durable image blocks. A running call keeps the prompt control over the spinner; settlement replaces the status with the shared attachment gallery or a failure. A lone image retains a 240×240 px frame, including attachment loading; explicit larger counts reserve additional rows.

A replayable Turn index records image call ids, displayed attachment ids and known artifact paths. Chat keeps call trees containing these image calls visible outside process disclosure; Tool hides ordinary ancestors and siblings while retaining each atomic image view. Expanding process restores those ordinary rows. The index contains no image bytes and adds no HTTP request or session event.

The generic tool card omits generated attachments already owned by an image view, including copies forwarded by a parent code-execution result. Assistant image blocks and Markdown sources repeating indexed generated artifacts are suppressed; other authored images retain the existing resolver. Tool descriptions and result summaries state that generated images are displayed and must not be repeated, embedded or presented by path. Typed workspace-copy outputs remain available; direct tool results record those paths in existing presentation metadata.

This partially supersedes [tool result images render in the card](../architecture/2026-09-02-tool-result-images-render-in-the-card.md): other image-bearing tools retain the generic card gallery and its shared renderer. The attachment package retains loading, retry, lightbox and download behavior through the Conversation image cache.

## The prompt control

Each frame carries a round prompt control in its lower-left corner rather than a caption under the image. It takes the Gallery's own round-control skin — a flat white disc carrying the lucide `terminal` glyph at 16 px, with no resting shadow and no hover state — and names itself through the app's tooltip. It opens the prompt in the dialog the connectors' skill popup uses: a card centred under the modal mask, its title row carrying a one-click copy of the whole prompt and the close control. The control is present while the call runs — above the loading sheet — and on the failure frame, so the prompt stays readable when generation fails. Every frame of a multi-image call carries its own control, and each opens the call's one prompt. The title, copy, copied, close and trigger strings come from the `imagine` dictionary.

## Consequences

Image display begins at the logged call start and requires no assistant restatement. The ordinary final assistant response still follows the tool result. Nested code-dispatch image calls share the same placement and image owner as direct calls. Video generation remains separate because job submission can settle before video bytes exist.

## Verification

Validation is limited to TypeScript checking and the build at the user's request: no test suite or live generation call is run.

## Alternatives considered

Expanding the process group to expose an image also exposes unrelated work and still provides no placeholder. Relying on a Markdown restatement makes placement dependent on model behavior. Rendering a second gallery outside the tool node duplicates ownership and can display the same attachment in both places. A progress event is unnecessary for a placeholder because the call/result lifecycle is already logged. A caption under the frame leaves the prompt with no visual tie to the image it produced and spends column height on every long prompt. A popover anchored to the control kept the prompt in the transcript's own layer, but the frame's rounded clip cropped it and it became a second dialog pattern beside the app's own; the shared modal card is the shape every other detail view already uses.
