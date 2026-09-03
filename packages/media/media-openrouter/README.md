---
description: "The OpenRouter video provider for ctx.media: submit, poll, and retrieve video jobs against one pinned origin, with OpenRouter's documented job states mapped onto the seam's union."
kind: "package-reference"
---

# @deepseek-ai/dsh-media-openrouter

English | [中文](README.zh.md)

## Summary

`dsh-media-openrouter` registers OpenRouter's video API as a `ctx.media` video backend: submit a job, poll it, and retrieve its bytes. OpenRouter brokers 28 video models at the time of writing — Wan, Seedance, Hailuo, and the FLUX video family — and is the only surveyed provider that enumerates its own job states, which is why the seam's status union follows its vocabulary and this adapter maps onto it directly. Mount it when a deployment wants video generation through an OpenRouter account.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads `dsh-media`; it registers as a video provider under `openrouter` by default. A caller starts a job with `ctx.media.startVideo()`, polls `ctx.media.videoStatus()` at its own cadence, and retrieves the clip with `ctx.media.fetchVideo()` once the job reports `succeeded`.

### Minimal configuration

`id` is the registry key, `apiKeyEnv` is the credential reference, and `maxVideoBytes` caps one retrieved clip; all three default. The credential resolves through `ctx.credentials` when that service is mounted, and falls back to the named environment variable.

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
- **Video only** — OpenRouter images are served by `dsh-media-pi-ai`, which reaches the same account through pi-ai's transports. A deployment wanting the dedicated image endpoint's extra controls has neither today.
- **No model catalog** — the model id passes through verbatim and is validated by OpenRouter, not here, so an invalid id fails upstream rather than before the call.
- **No webhook support** — the route accepts a `callback_url` for completion notification, which this provider does not forward; polling is the only completion path.
- **No cost reporting** — the submit response carries a usage estimate the seam has nowhere to hold, so it is dropped.
- **Upstream error text passes through unfiltered** — a failure message is surfaced as OpenRouter wrote it, so a deployment that treats provider text as untrusted should sanitize at the consumer.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: images here or in pi-ai

OpenRouter documents a dedicated image API with controls pi-ai's chat-modality path does not expose. Adding it here would give one package the whole OpenRouter media surface, at the cost of two packages both able to serve OpenRouter images; leaving it in pi-ai keeps the split by transport rather than by vendor. Undecided.

</details>
