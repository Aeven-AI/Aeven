# Agent Note: An image that cannot load says so

Status: implemented

English | [中文](2026-11-11-an-unloadable-image-says-so.zh.md)

## Problem

A markdown image whose source the host could not turn into a URL rendered as its alt text, and nothing else. An author who wrote only `![](path)` left nothing at all: the paragraph was empty, no marker, no source, no error. The reader took the reply for complete, and so did the model, which is how #630 stayed invisible from both sides for a whole session — the picture was there in the workspace the whole time.

The engine's renderer had that one silent branch by design: `MarkdownImage` returned `span.markdown-image-alt` for an unresolved source, so the reader saw prose where a picture was meant to be. Workspace sources resolve now, on the branch that carries that fix; a source outside the workspace, a scheme the policy refuses, or a stale path still resolves to nothing, and each of those is exactly the case a reader needs told.

## Decision

`MarkdownImage` draws an unresolved source as a visible block carrying the copy the host supplies (`imageUnavailableLabel`) and the source it failed to load, with the authored alt text beside them when there is one. `title` carries the full source for a path too long to read inline.

The engine owns no language, so the label is a `RendererOptions` field: absent, the older alt-only rendering stands rather than the engine inventing English. `ui-primitives` `MarkdownLabels` gains a required `imageUnavailable`, which is the same rule the package already applies to every other piece of chrome — omission fails typechecking, and each consumer maps its own `t` seat into it. Copy lives under `markdown.imageUnavailable` in the en, zh, and es dictionaries; the Chat labels factory and the three `MarkdownText` sites in the Integrations page both supply it.

## Alternatives considered

**Have the engine own the copy.** It would be one string instead of a required prop on every consumer, but the engine is Cordis-free and locale-free by contract, and `verify-client-ui-i18n` exists to keep product copy out of renderers. A hardcoded English label would also be the only English sentence in a Chinese reply.

**Name the source in the `title` and `aria-label` only.** That keeps the visual output unchanged, which is the bug: a hover-only marker is invisible in a screenshot, in a printed page, and to a reader who never hovers.

**Report the failure to the model as a tool result or a session event.** The image was authored in markdown, not through a tool, so there is no call to answer; and the reader's problem is that they saw nothing, which no model-visible signal fixes.

## Consequences

An image that fails to load now names the source that failed, in the reader's language, on both Hosts and wherever else `MarkdownText` renders — skill instructions in the Integrations page included. A deliberate alt-only image (`![](…)` with a URL that loads) is unchanged: the state appears when link safety refuses the source, resolution returns nothing, or the URL fails to load ([refused and failed images](2026-11-11-refused-and-failed-images-say-so.md)).

The block is structure and copy only: it carries no retry control, and it does not tell the reader *why* the source failed (an outside-the-workspace path and a deleted file look the same). Both are deferred; naming the source is what makes either diagnosable.

## Verification

`packages/client/hypermarkdown/tests/ui/image-unavailable.client.spec.tsx` renders an unresolved source with and without a label and with and without alt text, asserting the label, the source, the alt, and the `title`. `packages/client/ui-primitives/tests/markdown.client.spec.tsx` covers the same state through `MarkdownText`, and the DOM-parity fixtures that contain an unresolvable source were re-recorded. `pnpm run test:gui` and the typecheck pass.
