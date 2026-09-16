---
description: "The generate_image tool over ctx.media: one model-facing surface that resolves a request, generates through the selected provider, and stores the bytes as durable conversation attachments."
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-media

English | [中文](README.zh.md)

## Summary

`dsh-tool-media` publishes `generate_image`, the model-facing surface of the generated-media seam. It resolves a call's model and provider, generates through `ctx.media`, and stores each returned image with `ctx.attachments`, so the result carries durable image blocks rather than files or URLs. Mount it in a composition that already loads `dsh-media` and at least one image provider.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the tool alongside `dsh-media` and one or more image providers. `model` names the model a call gets when it asks for none, verbatim in the provider's own spelling; `provider` pins which registered provider serves those calls. Both default to absent, which defers to the seam's own selection and requires every call to name its model.

A deployment mounting two image providers pins one, either here or as the seam's `imageProvider`: the seam reports ambiguous selection rather than guessing.

### Requests

`prompt` is the only required argument. `model` and `provider` override this deployment's defaults for one call, which is how a single mounted tool reaches two providers whose model spellings differ. `n`, `aspect_ratio`, `resolution`, `size` and `seed` forward to the seam under its own names; only the fields a call set are sent, so each provider's own defaults apply to the rest.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`resolveRequest` performs defaulting as one explicit step, so a call naming no model and reaching no configured default fails by name instead of arriving at a provider as an empty id.

`storable` narrows a generated media type to the four raster formats the version-one attachment path stores. A provider may return something else — OpenRouter serves SVG on request, and bytes whose signature is unrecognized are labelled `application/octet-stream` — and that is refused here with the type named, rather than at the storage layer as a bare rejection.

`imageBlockRef` restores the `AttachmentId` brand that the output schema flattens to a string. The bytes were stored by this tool through `saveImage`, so the brand holds without a second storage read.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`generate_image` schema](../../../docs/tool-catalog.md#aeven-tool-media) with one required `prompt` and seven optional controls: `model` and `provider` for one-call overrides, and `n`, `aspect_ratio`, `resolution`, `size`, `seed` forwarded to the seam. The description names what a good prompt covers and tells the model not to call other tools to locate or verify the image, because the attachment is already the result.

#### Token effect

Fixed schema cost on every request where the tool is visible. The description and schema are stable for a given configuration; the configured default model does not appear in either.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

A success returns one line — `Generated <n> image(s) with <model> via <provider>.` — followed by one image block per stored image. A failure surfaces the seam's own message, which names the failing condition: an unnamed model, an ambiguous provider selection, an upstream HTTP status, or a media type that cannot be stored.

#### Token effect

Each returned image occupies visual tokens in every subsequent request that still carries it, which is far larger than the text line beside it. Generating several images in one call multiplies that cost for the rest of the session, until compaction or request-image offloading replaces them.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is a poor fit. They are current package constraints.

- **No invariant companion** — No companion is published. The tool owns no durable state and no independently observable relationship: the seam owns provider selection, `ctx.attachments` owns storage and verifies its own digests, and a stored reference is read back only through the store that wrote it.
- **No reference images** — the seam carries `references` for image-to-image work and both mounted providers accept them, but the tool takes no image argument, so editing an existing image is not reachable through it.
- **No video** — the seam models video as a job with its own polling and retrieval calls, which needs a tool surface of its own rather than an argument on this one.
- **One default model across providers** — the configured default is a single string, so a deployment pinning no provider and mounting two whose model spellings differ needs each call to name both.
- **No cost reporting** — providers report per-generation cost that the seam has nowhere to hold, so it does not reach the result.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Exposing reference images

Adding an image argument would make editing reachable, but the tool would then need to read attachments back out of the store to hand a provider its reference bytes, which is the first time this package would read rather than write. Undecided.

</details>
