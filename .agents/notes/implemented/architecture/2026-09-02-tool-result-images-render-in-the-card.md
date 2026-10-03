# Agent Note: Tool result images render in the card

Status: implemented

English | [中文](2026-09-02-tool-result-images-render-in-the-card.zh.md)

## Problem

A tool that produces an image had no way to show it. `ContentBlock` has carried an `image` arm since the Client began pairing tool results, `ToolResultNode.content` delivers those blocks to the Client unchanged, and image-producing tools already returned them from `render()`. Nothing in `ui-tool` read them: `GenericToolCard` mapped a result to a terminal, diff, read, search, or web card and otherwise flattened its content to text. The blocks were produced, transported, and dropped at the last step.

The visible consequence was that a generated image existed — stored, durable, addressable — but the transcript showed only a text summary. A reader saw the picture only by asking the model to restate it, at which point the assistant wrote a markdown image into its own message and `AssistantMarkdown` rendered it. The artifact was reachable only through a second model turn that might not happen.

## Decision

**A settled tool result's image blocks render in that tool's card, without registration.** `imageCardModel` derives the durable attachments from a settled, non-error result in content order, and `GenericToolCard` renders them through the attachment slot the chat node already supplies. Every tool returning image blocks gets this at once; none of them declares anything.

**The gallery sits below the row and outside the disclosure.** A generated image is the result, not a detail of it, so it does not wait for an expansion the reader has no reason to perform. The existing card sections stay where they are — they describe a result the summary line already names.

**Absence is text-only, never an empty frame.** A running call has no content, a failed result's partial content is diagnostic rather than a produced artifact, and a composition mounting no attachment presentation cannot draw an image at all. Each of those renders the row exactly as before.

**The renderer is the owner's, not the card's.** `ToolCallOwnerProps` gained an optional `renderImages`, threaded from the chat node's existing `renderMessageImages`. `ui-tool` keeps no attachment implementation and no image loader; it decides only *that* images belong in the card, while the attachment package keeps deciding how one is fetched and drawn.

Generated-image tools use the independent call views and placeholders described in [generated images at their tool calls](../feature/2026-10-02-generated-images-at-tool-calls.md). The generic gallery remains the fallback for other image-bearing tools.

## Consequences

Any tool returning `image` content blocks now shows them in the transcript with no further work, and a new image-producing tool inherits the behaviour by returning the block its `render()` already can. `ToolCallOwnerProps` gained one optional field, so registered business tool views keep compiling unchanged and opt in only by reading it.

A card can now grow taller than its summary line without being expanded, which changes transcript density for image-heavy turns. Results whose image blocks are incidental rather than produced artifacts would render them too; no shipped tool returns such blocks today, and a tool wanting different treatment registers its own `tool.call.toolview`.

## Verification

`imageCardModel` unit coverage pins content order, the running/failed/text-only empties, and the mixed text-and-image case. `GenericToolCard` component coverage asserts the attachment slot receives the derived group with `align: 'start'`, that a composition without `renderImages` renders no gallery, and that a result carrying no images never calls the renderer. The `ui-tool`, `ui-chat`, and `ui-conversation` suites cover the threading unchanged.

## Alternatives considered

**Have the tool emit a markdown image tag in its result text.** This is what the official Grok CLI does — its `image_gen` description instructs the model to restate the session-relative path so it renders as a link. Rejected as the primary mechanism: it makes display contingent on the model complying, it needs a servable URL that attachment ids do not have, and it would have to be repeated in every image-producing tool. The block is already in the result; the renderer was the missing half.

**Render inside the expanded disclosure, beside the other cards.** Rejected because it preserves the actual complaint. The reader would still have to expand a row to discover that a picture was produced.

**Give each image tool its own registered `tool.call.toolview`.** Rejected as the wrong altitude: the image arm is a `ContentBlock` type, not one tool's private shape, so a per-tool view would duplicate the same derivation for every current and future producer.
