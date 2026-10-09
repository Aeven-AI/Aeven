# Agent Note: Selected image generation preserves supplied prompts

Status: implemented

English | [中文](2026-10-08-selected-image-generator-and-verbatim-prompts.zh.md)

## Problem

The shipped agent defers both the regular image generator and subscription-specific tools behind a names-only index. A photo-editing request selects Codex without inspecting the regular generator, guesses attachment identifiers, and retries backend timeouts. The eventual regular-generator call expands the supplied prompt and overrides the selected model.

## Decision

The shipped `aeven` composition exposes `generate_image` from the first request. Its standing instructions use the selected model unless the user requests another, pass supplied image prompts verbatim, and pass uploaded references by their normalized-copy paths without copying. Subscription-specific tools require an explicit provider request. Each request generates once; another generation requires a user request. The image tool description also preserves supplied prompts, and attachment handles require copying only for modifying the file itself. Generation failures are reported without automatic retries or repository inspection unless debugging is requested.

## Alternatives considered

**Remove subscription image capabilities.** Those providers remain selectable through the regular generator and explicitly callable when requested; deleting them exceeds the routing correction.

**Change only the tool description.** A deferred description cannot guide the initial choice from the names-only index. The regular generator is visible before discovery and the standing instructions govern the choice.

## Consequences

The first request carries one additional tool schema. Prompt preservation and route choice depend on model compliance with the standing instructions; the provider and tool executor remain unchanged. The image renderer still settles through the existing call and result events.
