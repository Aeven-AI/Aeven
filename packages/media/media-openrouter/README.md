---
description: "The OpenRouter image and video provider for ctx.media: generate images through the dedicated image route, and submit, poll, and retrieve video jobs against one pinned origin."
kind: "package-reference"
---

# @aeven/media-openrouter

English | [中文](README.zh.md)

## Summary

`dsh-media-openrouter` registers OpenRouter as both a `ctx.media` image backend and a video backend. Images are one call against OpenRouter's dedicated `/api/v1/images` route, which is where OpenRouter adds new image models; video is a job — submit, poll, and retrieve its bytes. OpenRouter brokers 28 video models at the time of writing — Wan, Seedance, Hailuo, and the FLUX video family — and is the only surveyed provider that enumerates its own job states, which is why the seam's status union follows its vocabulary and this adapter maps onto it directly. Mount it when a deployment wants image or video generation through an OpenRouter account.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads `dsh-media`; it registers as both an image and a video provider under `openrouter` by default. A caller generates images with `ctx.media.generateImage()`. A caller starts a job with `ctx.media.startVideo()`, polls `ctx.media.videoStatus()` at its own cadence, and retrieves the clip with `ctx.media.fetchVideo()` once the job reports `succeeded`.

### Minimal configuration

`id` is the registry key, `apiKeyEnv` is the credential reference, and `maxVideoBytes` caps one retrieved clip; all three default. The credential resolves through `ctx.credentials` when that service is mounted, and falls back to the named environment variable.

### Images

`generateImage` posts to the dedicated `/api/v1/images` route rather than chat completions. That choice is load-bearing: OpenRouter adds new image models exclusively to the dedicated route, and its chat route refuses these models at its tool-compatibility routing step, so a harness that reaches them through chat completions gets an HTTP 404 naming tool support. `n`, `aspectRatio`, `resolution`, `size` and `seed` forward under the route's own field names, and reference images ride as `input_references` data URIs.

Returned images are base64 in `data[].b64_json`. The route reports `media_type` only when it could identify the format, so an entry without one is labelled from its own signature; a row carrying no encoded image is skipped, and a response yielding none at all is an error rather than an empty success.

### Requests

`duration`, `aspectRatio`, `resolution`, `size`, `seed` and `generateAudio` forward to the route's own field names, and reference images ride as `input_references` data URIs — so image-to-video and reference-guided generation work through the same call. Only fields the caller set are sent, so the model's own defaults apply to everything else.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Status mapping

`pending` and `in_progress` both mean "poll again", so both become `running`. `cancelled` and `expired` become `failed` rather than a fourth seam state, because a caller's next move for each is what it is for `failed`. An unrecognized status keeps the job `running`: OpenRouter may add one, and a caller that keeps polling recovers, while a caller told `failed` cannot.

### Retrieving bytes

`fetchVideo` reads the route's own content endpoint, which proxies the raw bytes, rather than any URL a job body carries. That keeps egress on this one origin instead of following whichever upstream vendor served the model. The clip is size-capped twice — once on the declared `Content-Length` and again on the received bytes — because a provider may under-declare.

### Source map

- `src/index.ts` — config, credential resolution, the status table, and the three job operations.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumer that mounts the media seam; this provider registers no tool and contributes no prompt.

#### KV Cache effect

No direct invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **No invariant companion** — No runtime invariant companion is published because this package owns no relationship two independent observers could disagree about; its single registration is disposed with the calling fiber and covered by the package's tests.
- **Two packages can serve OpenRouter images** — `dsh-media-pi-ai` reaches the same account through pi-ai's chat-modality transport and registers under the same default id, so a composition mounting both must give one of them a different `id`. This package's dedicated route is the one that receives new image models.
- **No streaming** — the image route accepts `stream` for incremental delivery, which this provider does not request; a call returns once, when every image is ready.
- **`quality`, `output_format`, `background` and `output_compression` are not forwarded** — the seam carries no field for them, so the model's own defaults apply. Requesting SVG would in any case produce bytes the version-one attachment path cannot store.
- **No model catalog** — the model id passes through verbatim and is validated by OpenRouter, not here, so an invalid id fails upstream rather than before the call.
- **No webhook support** — the route accepts a `callback_url` for completion notification, which this provider does not forward; polling is the only completion path.
- **No cost reporting** — the submit response carries a usage estimate the seam has nowhere to hold, so it is dropped.
- **Upstream error text passes through unfiltered** — a failure message is surfaced as OpenRouter wrote it, so a deployment that treats provider text as untrusted should sanitize at the consumer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Retiring the pi-ai image path

With the dedicated route implemented here, `dsh-media-pi-ai` is a second way to reach the same account for the same kind, over a transport OpenRouter treats as legacy and against a model list frozen into the installed pi-ai. Whether that package keeps a reason to exist is open; retiring it would remove the id collision named in the limits above.

</details>
