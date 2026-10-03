# Agent Note: Generated images at their tool calls

Status: implemented

English | [中文](2026-10-02-generated-images-at-tool-calls.zh.md)

## Problem

Generated images inside a tool card disappear when the Turn process is collapsed. The reader sees no generation placeholder, and an assistant restating the image can create another copy or make display depend on a later model response.

## Decision

Imagine registers atomic views for `generate_image`, `codex_image_generate`, `codex_image_edit` and `grok_imagine_image`. The existing tool-call node owns the prompt, running/result state and durable image blocks. A running call displays a prompt caption, spinner and elapsed time; settlement replaces the status with the shared attachment gallery or a failure. A lone image retains a 240×240 px frame, including attachment loading; explicit larger counts reserve additional rows.

A replayable Turn index records image call ids, displayed attachment ids and known artifact paths. Chat keeps call trees containing these image calls visible outside process disclosure; Tool hides ordinary ancestors and siblings while retaining each atomic image view. Expanding process restores those ordinary rows. The index contains no image bytes and adds no HTTP request or session event.

The generic tool card omits generated attachments already owned by an image view, including copies forwarded by a parent code-execution result. Assistant image blocks and Markdown sources repeating indexed generated artifacts are suppressed; other authored images retain the existing resolver. Tool descriptions and result summaries state that generated images are displayed and must not be repeated, embedded or presented by path. Typed workspace-copy outputs remain available; direct tool results record those paths in existing presentation metadata.

This partially supersedes [tool result images render in the card](../architecture/2026-09-02-tool-result-images-render-in-the-card.md): other image-bearing tools retain the generic card gallery and its shared renderer. The attachment package retains loading, retry, lightbox and download behavior through the Conversation image cache.

## Consequences

Image display begins at the logged call start and requires no assistant restatement. The ordinary final assistant response still follows the tool result. Nested code-dispatch image calls share the same placement and image owner as direct calls. Video generation remains separate because job submission can settle before video bytes exist.

## Verification

Validation is limited to TypeScript checking and the build at the user's request. No test suites or live generation calls are run for this change.

## Alternatives considered

Expanding the process group to expose an image also exposes unrelated work and still provides no placeholder. Relying on a Markdown restatement makes placement dependent on model behavior. Rendering a second gallery outside the tool node duplicates ownership and can display the same attachment in both places. A progress event is unnecessary for a placeholder because the call/result lifecycle is already logged.
