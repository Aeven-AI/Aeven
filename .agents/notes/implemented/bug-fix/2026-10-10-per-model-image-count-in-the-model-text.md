# Agent Note: The per-model image count is stated where the model is authored

Status: implemented

English | [中文](2026-10-10-per-model-image-count-in-the-model-text.zh.md)

## Problem

`generate_image` publishes one sentence describing each selectable model, built from the composition's `choices` by `modelsText` and, for models a provider lists itself, from that provider's own catalog entry. The [decision that made the description list each choice's options](../architecture/2026-10-01-aeven-image-models-only.md) carried every per-model fact into that sentence — sizes, reference-image counts, backgrounds, seeds — except the number of images one request may ask for. The count is a provider-owned, per-model request limit: `media-aeven` declares `maxImages` on each Aeven image model and `requestBody` refuses an `n` outside it before any request is made. The descriptions the model read never named it, so a model composed `n` above the cap, the provider refused the whole call, and the turn ended with no image at all — a bound that is documented in the package README and enforced in code, but invisible on the surface the model reads.

The same defect ran the other way in `media-pi-ai`. Its upstream route carries no count, so `request.n` was dropped silently: a call asking for several images received one and reported success, telling the caller nothing about the count it did not get.

## Decision

**A model's own text states its per-call image count.** `AEVEN_IMAGE_MODELS` descriptions now carry the count `maxImages` enforces, and the shipped `aeven` preset's configured image choices state it too, because `modelsText` renders those choices into the `generate_image` description at registration. The count stays per model and per provider: `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro` state four each, pi-ai's models state none and take none, and OpenRouter and DeepInfra leave the count to their own routes. No harness-wide figure is stated anywhere.

**`generate_image` names no bound of its own.** The `n` argument says the count comes from the chosen model's description, and the tool description tells the model that more images than one call accepts is another call. `resolveRequest` gained no second validator: the provider refuses an unhonorable count before spending anything, and the tool's job is to say what a model may ask for, not to restate what the provider enforces.

**A provider that cannot honor a count refuses it.** `media-pi-ai` rejects `n` above one with `MEDIA_INVALID_REQUEST`, matching the seam's rule that a provider which cannot honor an option rejects the request rather than silently producing something else. A count of one is accepted, because the route answers one image anyway.

## Verification

Each statement is pinned against the field that enforces it, so the prose cannot drift from the provider. `media-aeven`'s spec asserts that every shipped model's description contains `up to <maxImages> images per call`. The real-composition spec boots the shipped preset through the Loader and checks that each configured choice's clause in the model-visible `generate_image` description states the count its provider declares. `tool-media`'s spec pins the `n` description and the recovery sentence. `media-pi-ai`'s spec pins the refusal and the accepted count of one. `packages/media/media-aeven/tests/media-aeven.spec.ts`, `packages/media/tool-media/tests/loader-composition.spec.ts`, `packages/media/tool-media/tests/tool-media.spec.ts`, `packages/media/media-pi-ai/tests/media-pi-ai.spec.ts`.

## Alternatives considered

**Carry the limit on the seam as `MediaImageModel.maxImages` and refuse over-count calls in the tool.** Rejected because it adds a validator for a constraint the provider already enforces at the last point before spending, and because every other per-model fact — sizes, durations, aspect ratios, reference counts, guidance support — reaches the model as that model's own text. A structured count alone would be a missed extraction rather than a fix.

**Split a large request across several provider calls inside the tool.** Rejected because one tool call would silently become two charges: the picker, the reported cost, and the `Generated <n> image(s)` line all describe one provider call. A second call the model makes deliberately keeps those facts true, and the model can tell the user what it is doing.

**State a single maximum in the `n` description.** Rejected because the count differs per model and per provider. Aeven's models take four, pi-ai takes none, and OpenRouter and DeepInfra pass the count to routes whose own limits the harness does not know.

**Compose the choice descriptions from the provider catalog instead of the preset.** Rejected: the tool description is built once at registration and `ctx.media.listImageModels()` is asynchronous, so the composition's choices remain the authored home for what the model reads, exactly as the video choices already are.

## Consequences

- A model asks for a count its chosen model accepts, and asks again for more, so the Aeven models no longer fail a whole generation on a count the model could have known.
- Each count has two authored homes — the provider's catalog and the shipped preset's choice — as every other option fact already does. Specs bind each home to the field that enforces it, so a change to `maxImages` without the text fails a test rather than reaching a model.
- The harness still states no bound for a model whose provider declares none; such a call keeps failing at that provider's route, with the provider's own message.

## Deferred

`media-pi-ai` still does not forward `aspectRatio`, `resolution`, `size`, or `seed`, so a request naming one of them generates at the model's own settings. That gap is a documented limitation of the package rather than part of this defect, and refusing those options belongs in its own change.
