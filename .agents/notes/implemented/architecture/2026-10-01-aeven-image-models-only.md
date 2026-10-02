# Agent Note: Aeven's two image models are the only image models

Status: implemented

English | [中文](2026-10-01-aeven-image-models-only.zh.md)

## Problem

The [image generation tool](2026-09-08-image-generation-tool-and-openrouter-images.md) and the [generated-media providers](2026-09-03-generated-media-providers.md) made every mounted vendor's image models reachable. Asking Aeven for an image opened a picker of seven models from three vendors — Grok Imagine, three DeepInfra FLUX models, and three OpenRouter models — plus an "Other" option that listed every model every mounted provider published, including the Grok Imagine and GPT Image entries the subscription plugin registered into the seam. None of them was an Aeven model, each needed a vendor key or subscription the user may not hold, and the picker opened before the first generation. Meanwhile the Aeven gateway already served `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro` on `POST /v1/images/generations`, and no Aeven provider reached it.

The gateway also decided which options each model accepts by `pixelPriced`, a pricing flag: any pixel-priced model refused `background` and `optimize_prompt_mode`, and reference images were named `input_image_N` whenever explicit dimensions were sent.

## Decision

**`avn-media-aeven` is the one image provider the Web composition mounts.** It registers `aeven` on `ctx.media`, serves the two Aeven models through the gateway with the signed-in Aeven session as the bearer — the same credential `llm-aeven` and the Aeven web search present — and resolves that session per generation for the owner of the generating Session, so no vendor key is held. The DeepInfra and OpenRouter media rows are removed from the composition.

**The catalog is shipped and always offered.** `available()` is always true and `listImageModels` answers from `AEVEN_IMAGE_MODELS`, for the reason [`llm-aeven`](../../../../packages/llm/llm-aeven/README.md) ships its chat catalog: the gateway's `GET /v1/models` is entitlement-scoped, the wrong input for a menu every account reads. A missing sign-in or plan is reported by the generation, naming the remedy.

**`choices` is the whole selectable set, enforced at request resolution.** The shipped presets list Flash and Pro; `resolveRequest` refuses any other model, so neither the picker, `/image-models`, nor a model named in a call can select one. The "Other — list every image model" escape hatch is removed. The presets default to Flash with `confirmModel: false`, so the first generation runs without a modal, and `/image-model` is renamed `/image-models`, the surface that changes the stored choice.

**The subscription plugin registers no media-seam providers.** Its Grok Imagine and Codex tools stay; only their duplicate registration into `ctx.media` is removed, because the seam's image models are now the deployment's own and a per-subscription entry there is an "other model". [Subscription providers with per-model selection](../feature/2026-10-02-subscription-providers-model-selection.md) restores the two registrations, offered only through `tool-media`'s explicit `listedProviders` and only while the user keeps the model selected.

**`generate_image` reaches reference images and the background option.** `reference_images` takes paths read through `ctx.fs`, which covers both workspace files and the normalized copy of a conversation image the model was shown; `background` maps to a new seam field, `MediaImageRequest.background`. The tool drops `provider`, `aspect_ratio`, `resolution`, and `seed`, which no Aeven model accepts, and its description lists each choice with its options so the model knows Pro is the one with a background.

**The gateway's catalogue entries state each model's options.** `inputImageFields`, `backgrounds`, and `optimizePromptModes` replace the `pixelPriced` gate; the normalizer refuses an option a model lacks by name, the DeepInfra adapter names reference images from the entry, and `GET /v1/models` lists the whole per-model vocabulary.

## Consequences

The image-model catalog served to selectors (`imageModelCatalog`) and the picker now hold exactly the two Aeven models in the Web composition. Image models never entered the chat model selector or `/models`: the gateway tags them `image` rather than `chat`, and the chat catalogs filter on `chat`.

`avn-media-deepinfra`, `avn-media-openrouter`, and `avn-media-pi-ai` remain packages a composition may mount, but no shipped composition mounts them.

The shipped catalog mirrors the gateway: a model the gateway adds is not offered until this list ships it. The gateway now publishes the vocabulary a future widening step would read.

## Verification

Unit coverage is 100% across `avn-media`, `avn-media-aeven`, and `avn-tool-media`: the shipped catalog and its order, request translation and every early refusal, gateway error mapping, per-user credential resolution and its fallback, reference reading through a filesystem double, and the `choices` restriction through the executor. The gateway's unit suites assert each model's options in the catalogue, the listing, the normalizer refusals, and both reference-field namings.

## Alternatives considered

**Fetch the image catalog from `GET /v1/models`.** Rejected: the listing answers with one account's entitlements, so a model the account lacks would vanish from the menu instead of explaining what the account needs.

**Keep the vendor providers mounted and only trim `choices`.** Rejected: the seam's catalog, which `imageModelCatalog` serves, would still list every vendor model, and a model named in a call would still reach them.

**Validate every option in the tool from a seam-level options descriptor.** Rejected for now: the provider owns its catalog and refuses what its models lack, and the gateway refuses the rest; a seam descriptor has no second consumer.
