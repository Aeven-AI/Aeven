---
description: "The generate_image and generate_video tools over ctx.media: model-facing surfaces that resolve a request, generate through the selected provider, and store the bytes as durable conversation attachments."
kind: "package-reference"
---

# @aeven/tool-media

English | [中文](README.zh.md)

## Summary

`avn-tool-media` publishes `generate_image` and, where `video` is configured, `generate_video`: the model-facing surfaces of the generated-media seam. Each resolves a call's model and provider and generates through `ctx.media`; images are stored with `ctx.attachments` as durable image blocks, and a finished clip as a durable file block, rather than files or URLs. Mount it in a composition that already loads `avn-media` and at least one image provider, plus a video provider where `video` is set.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the tool alongside `avn-media` and one or more image providers. `model` names the model a call gets when it asks for none, verbatim in the provider's own spelling; `provider` pins which registered provider serves those calls. Both default to absent, which defers to the seam's own selection and requires every call to name its model.

`choices` is the whole set of selectable models, each naming its provider. When it is non-empty, the picker, the `/image-model` command, and a model a call names are all limited to it, so a model outside the list is refused before any generation. The shipped presets list `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro`, default to Flash, and set `confirmModel: false`, so the first generation runs on Flash without asking and `/image-model` changes the stored choice: the bare line opens a picker, and `/image-model <provider>/<model>` — or a bare model id exactly one offered choice carries — stores that model directly.

`listedProviders` names media providers whose own image-model listing is offered after `choices`. The listing is read on every call, so the picker, `/image-model`, and call validation follow a provider whose models change at runtime. The shipped presets name `grok-subscription` and `codex-subscription`, whose image models are listed while the subscription is signed in and the model is switched on in Settings → Providers.

A deployment mounting two image providers pins one, either here or as the seam's `imageProvider`: the seam reports ambiguous selection rather than guessing.

`video` configures `generate_video` with the same `model`, `provider`, `choices`, `confirmModel` and `maxReferenceImageBytes` fields, stored in their own `media-video` settings document, plus `pollIntervalMs` (5 s by default) and `maxWaitMs` (31 min by default) for the job wait. Omitting `video` registers neither the tool nor `/video-model`. The shipped preset offers `Aeven-1.0-Video-Flash` (the default) and `Aeven-1.0-Video-Pro`, defaults to Video Flash with `confirmModel: false`, and `/video-model` changes the stored choice exactly as `/image-model` does for images.

### Requests

`prompt` is the only required argument. `model` overrides the selected model for one call and is served by the provider its choice names. `n`, `size`, `resolution`, `seed` and `background` forward to the seam; `guidance_scale`, `output_format` and `optimize_prompt_mode` map to its camel-case fields; only the fields a call set are sent, so the provider's own defaults apply to the rest, and a provider refuses an option the chosen model lacks. `reference_images` names image files in the order the prompt refers to them; each is read through `ctx.fs` under the session's working directory, bounded by `maxReferenceImageBytes` (4 MiB by default), labelled by its bytes, and sent to the provider as a reference. A conversation image is passed by the normalized-copy path its handle text shows.

`generate_video` also requires only `prompt`. `model` overrides the selected video model for one call; `duration`, `resolution`, `aspect_ratio`, `seed` and `generate_audio` forward to the seam's video request; `reference_images` names at most two images, read as above, which the provider uses as the first and last frame.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

`resolveRequest` performs defaulting as one explicit step, so a call naming no model and reaching no configured default fails by name instead of arriving at a provider as an empty id. It is also where the `choices` restriction is enforced, because every generation passes through it whatever the picker did.

`readReferences` reads reference images through the mounted filesystem backend, so a workspace file and a conversation image's normalized copy are read the same way. A call naming references where no filesystem is mounted fails by name.

`storable` narrows a generated media type to the four raster formats the version-one attachment path stores. A provider may return something else — OpenRouter serves SVG on request, and bytes whose signature is unrecognized are labelled `application/octet-stream` — and that is refused here with the type named, rather than at the storage layer as a bare rejection.

`imageBlockRef` restores the `AttachmentId` brand that the output schema flattens to a string. The bytes were stored by this tool through `saveImage`, so the brand holds without a second storage read. `fileBlockRef` does the same for a clip stored through `saveFile`.

`generate_video` starts the provider's job, then `awaitVideo` reads it every `pollIntervalMs` until it succeeds, fails, or `maxWaitMs` passes, with the call's abort signal ending the wait. The finished clip is stored with `saveFile` under the model's name and a one-line text naming the model and prompt, which is what the model reads in place of the bytes. The model-selection fields, the picker, and the `/image-model` and `/video-model` commands come from one `installSelection` per kind, so both behave identically.

-----

<a id="model-experience"></a>
## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`generate_image` schema](../../../docs/tool-catalog.md#aeventool-media) with one required `prompt` and optional controls: `model` for a one-call override; `n`, `size`, `resolution`, `seed`, `guidance_scale`, `output_format`, `optimize_prompt_mode` and `background` for supported generation settings; and `reference_images` for editing or drawing from existing images. The description names what a good prompt covers, how to pass reference images, and each configured choice with its description and the default, so the model knows which model has which option; it tells the model not to call other tools to locate or verify the image, because the attachment is already the result. The [`generate_video` schema](../../../docs/tool-catalog.md#aeventool-media) has the same `prompt`, `model` and `reference_images` arguments plus `duration`, `resolution`, `aspect_ratio`, `seed` and `generate_audio`, and its description names the video choices and states that generation takes minutes.

#### Token effect

Fixed schema cost on every request where the tool is visible. The description and schema are stable for a given composition configuration; the description names the composition's choices and default, not a choice a person stored later.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool-call history and result

#### What the model sees

A success returns one line — `Generated <n> image(s) with <label>. Charged $<amount> to the user's Aeven account. Already displayed to the user; do not repeat or embed them in your reply.` — followed by one image block per stored image. Imagine renders these blocks at the generating call, including its in-flight placeholder; no assistant restatement is needed. A failure surfaces the seam's own message, which names the failing condition: an unnamed or unavailable model, an option the model lacks, an unreadable reference image, an upstream refusal, or a media type that cannot be stored. A video success returns `Generated a video with <label>. Charged $<amount> to the user's Aeven account. Already displayed to the user with playback controls; do not repeat or embed it in your reply.` followed by one file block, which reaches the model as an `<attached_file>` element carrying the stored text and the clip's path; Imagine plays it at the call. `<label>` is the offered choice's label, e.g. Aeven Video Pro, and the charge sentence appears only when the provider reports one. A failed or timed-out job surfaces the provider's reason.

#### Token effect

Each returned image occupies visual tokens in every subsequent request that still carries it, which is far larger than the text line beside it. Generating several images in one call multiplies that cost for the rest of the session, until compaction or request-image offloading replaces them.

#### KV Cache effect

Append-only; newly visible content follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the package is a poor fit. They are current package constraints.

- **No invariant companion** — No companion is published. The tool owns no durable state and no independently observable relationship: the seam owns provider selection, `ctx.attachments` owns storage and verifies its own digests, and a stored reference is read back only through the store that wrote it.
- **A video call holds its tool slot for the whole render** — the job is awaited inside the call, so a render of several minutes keeps the call open; the model cannot do other work in that turn meanwhile.
- **Cost only where the provider reports it** — the result states a charge only when the provider sets `costUsdMicros`; otherwise it names no price, and the model has no other source for one.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Reference images by attachment id

References are read by path, which needs a mounted filesystem. Accepting a conversation image's attachment id would need the full durable reference, which only the session log holds. Undecided.

</details>
