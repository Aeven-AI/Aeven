---
description: "The pi-ai image provider for ctx.media: how a deployment reaches OpenRouter's image catalog through pi-ai's own transports, with credentials, request translation, and failure mapping owned here."
kind: "package-reference"
---

# @aeven/media-pi-ai

English | [中文](README.zh.md)

## Summary

`avn-media-pi-ai` registers pi-ai's images registry as a `ctx.media` image backend, so a deployment that already trusts pi-ai for chat reaches its image catalog the same way. pi-ai owns the transports and the model metadata — 45 OpenRouter image models at the pinned version, including the FLUX.2 and Seedream families — while this package owns credential resolution, translating the seam's request into pi-ai's input content, and turning pi-ai's in-band failures into `MediaError`. Mount it when a deployment wants OpenRouter images without a hand-written client.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads `avn-media`; it registers as an image provider under `openrouter` by default, so `ctx.media.generateImage()` resolves it automatically when it is the only usable image backend — or name it in the request.

### Minimal configuration

`id` is the registry key and `apiKeyEnv` is the credential reference; both default, so a single-provider deployment needs no configuration. The credential resolves through `ctx.credentials` when that service is mounted, and falls back to the named environment variable.

### Requests

The seam's prompt becomes pi-ai's leading text content, and each reference image follows it as inline base64 in the order given, which is what the image-to-image models read as their references. The model id passes through verbatim: this provider validates only that pi-ai's catalog knows it, and rejects an unknown id before spending a call.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Calling through the provider object

pi-ai exposes `generateImages` from its images registry, but that module is absent from the package's export map. The provider object `openrouterImagesProvider()` returns carries its own `generateImages`, so this package calls through it — which also keeps model, auth, and transport resolved by one object rather than three imports that could drift apart.

### Failure is in the result, not a throw

pi-ai reports failure by returning a result with an `error` stop reason rather than by throwing. This package converts that into a `MediaError` so a caller never receives an empty success, and treats a stopped result carrying only text the same way: a model that declined to draw is an upstream failure from the seam's point of view, not zero images.

### Source map

- `src/index.ts` — config, credential resolution, request and result translation, registration.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumer that mounts the media seam; this provider registers no tool and contributes no prompt.

#### KV Cache effect

No direct invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **No invariant companion** — No runtime invariant companion is published because this package owns no relationship two independent observers could disagree about; its single registration is disposed with the calling fiber and covered by the package's tests.
- **Images only** — pi-ai models no video seam at all, so a deployment wanting video mounts a provider that speaks a video API directly.
- **The catalog is pinned to pi-ai's snapshot** — the model list ships with the pi-ai version this workspace resolves, so a model OpenRouter added later is unknown until pi-ai is upgraded, and is rejected as an unserved model rather than attempted.
- **`n`, `aspectRatio`, `resolution`, `size` and `seed` are not forwarded** — pi-ai's images context carries prompt and reference images only. A deployment needing those controls wants OpenRouter's dedicated image endpoint rather than the chat-modality path pi-ai uses.
- **No cost or usage reporting** — pi-ai returns usage on its result, but the seam has nowhere to carry it, so it is dropped.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: the dedicated image endpoint

pi-ai drives image generation through chat completions with an image modality, while OpenRouter now documents a dedicated image API carrying `n`, `resolution`, `aspect_ratio` and reference controls. Whether those controls arrive by upgrading pi-ai, or by this package calling that endpoint itself and leaving pi-ai for the models it uniquely covers, is undecided.

</details>
