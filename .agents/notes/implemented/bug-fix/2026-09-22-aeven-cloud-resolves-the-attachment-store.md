# Agent Note: The Aeven route resolves the attachment store

Status: implemented

English | [中文](2026-09-22-aeven-cloud-resolves-the-attachment-store.zh.md)

## Problem

Every image-bearing turn on the deployment's own route failed with `UNSUPPORTED_CONTENT`: *"DeepSeek image conversion requires the durable attachment service."* The turn that surfaced it had called `read_image` one step earlier and that call had **succeeded** — the tool, which is registered only while a durable store is mounted, had saved the image and answered with a content-addressed reference. The refusal came from the model request assembled right after it.

`@aeven/llm-aeven` registers the Aeven gateway route by reusing `DeepSeekAdapter` and passing it three hooks. It passed `options`, `resolveApiKey`, `resolveUserId`, and `prepareExtensions` — but not `resolveAttachments`, and not the read-only access bridge. The adapter's option is optional, and the plugin's module doc described the omission as deliberate: *"The DeepSeek-only paths (file upload, image offload) stay unconfigured here, because the gateway accepts images inline as `image_url` parts and has no files API to upload them to."*

That sentence conflated two different paths. The Files API is genuinely absent from the gateway and stays unconfigured. Attachment resolution is what turns a durable reference into bytes at all — without it there is nothing to send inline, so the inline form the doc describes was unreachable. Every conversation holding an image met the refusal before anything was serialized: a pasted screenshot as much as a `read_image` result.

`@aeven/llm-deepseek` and `@aeven/llm-pi-ai` both pass `resolveAttachments: () => ctx.get('attachments')` and the same access bridge, and the subscription-auth adapters receive theirs from their own call site, so this route was the only one missing it.

## Decision

The Aeven route resolves the same two hooks the DeepSeek route does: `resolveAttachments` reads `ctx.get('attachments')` per request — the store the base composition mounts beside this row — and `resolveImageAccess` bridges one reference into the current tool execution world through `ctx.get('fs')?.processPathFromHostPath`, exactly as the sibling routes do.

The Files API stays unconfigured, which is now stated as the one deliberate omission: the adapter's file representation is attempted first and fails over to base64 when the gateway answers 404, so an image reaches the gateway in the form the gateway accepts. The fallback is the adapter's existing behaviour for an upload that cannot happen, not something this route adds.

The regression is pinned end to end against the real local store and a gateway double that refuses `/files`: the image rides the chat body as an inline data URL, its handle names the normalized copy when a filesystem is mounted, and a request with no image never enters the image path. Removing the two hooks reproduces the production refusal verbatim.

## Alternatives considered

Wiring a Files API was rejected: the gateway has none, and inventing one to keep a file-id representation would make the deployment refuse images for the same reason in a different place. Making the adapter treat a missing store as "send text only" was rejected as well, because the turn would then quietly answer a question about an image the model cannot see, which is worse than the refusal it replaced and is not what `Aeven-1.0-Flash` advertises. Sharing the DeepSeek route's adapter construction through a factory was considered and left alone: the two routes differ in authority, defaults, and extensions, and the shared transport is already the part that matters.

## Consequences

- Images work on `aeven-cloud`: `read_image` results and attached screenshots reach the model inline, after one refused Files API attempt per image-bearing request.
- `Aeven-1.0-Flash` advertises `image` input, which was previously a claim this route could not honour; `Aeven-1.0-Pro` still refuses images in the adapter's own words.
- `@aeven/attachment` and `@aeven/fs` are declared as peers of `@aeven/llm-aeven`, mirroring `@aeven/llm-deepseek`, and the lockfile records the two links.
