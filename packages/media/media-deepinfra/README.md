---
description: "The DeepInfra image and video provider for ctx.media: native Seedream and OpenAI-compatible image generation, with submit/poll/retrieve video jobs, with DeepInfra's observed job states mapped onto the seam's union."
kind: "package-reference"
---

# @aeven/media-deepinfra

English | [中文](README.zh.md)

## Summary

`avn-media-deepinfra` registers DeepInfra as both an image and a video backend for `ctx.media`. Seedream images use native inference and credential-free Ark CDN downloads; other images use DeepInfra's OpenAI-compatible route and come back as base64; video is a job — submit, poll, retrieve — against the same account and origin. DeepInfra brokers 16 models tagged `video-gen` at the time of writing, from Wan and Seedance to Veo, at per-second pricing. Mount it when a deployment wants both media from one DeepInfra key.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount the provider in a composition that already loads `avn-media`; it registers under `deepinfra` for both media, so one mount serves `ctx.media.generateImage()` and the video job methods.

### Minimal configuration

`id` is the registry key, `apiKeyEnv` is the credential reference, and `maxVideoBytes` caps one retrieved clip, and `maxImageBytes` caps each native image download at 32 MiB; all fields default. The credential resolves through `ctx.credentials` when that service is mounted, and falls back to the named environment variable.

### Requests

Image models come from `GET /models/list`, selecting non-deprecated `text-to-image` entries. The OpenAI-shaped listings omit Seedream 4.5 and 5.0 Pro. Seedream 4, 4.5 and 5.0 Pro use `POST /v1/inference/{model}`; `size` or `resolution` supplies a model-supported tier or `WIDTHxHEIGHT`, and `n` makes that many native calls.

| Control | Seedream 4 / 4.5 | Seedream 5.0 Pro |
|---|---|---|
| Tiers | 2K (default), 4K; 1K on Seedream 4 | 1K, 1.5K, 2K (default) |
| References | one | up to four, in order |
| `seed` | −1 (random) to 4294967295; not reproducible | refused |
| `guidanceScale` | 1–10 | refused |
| `outputFormat` | refused | `png` or `jpeg` |
| `background` | refused | `transparent` or `opaque` |
| `optimizePromptMode` | refused | `standard` or `fast` |

Transparent output requires a single alpha-channel reference and cannot use JPEG. Other image models retain the compatible route's explicit pixel size, one reference, `background` and base64 response. Video requests forward `duration` as `seconds`, plus `aspectRatio`, `size` and `seed`; the first reference supplies the `image_url` first frame.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### `queued` means running

DeepInfra reports `queued` for a job that is actively rendering and publishes no running value at all: three observed jobs, including a 10-second clip taking 27.6 seconds, went `queued` → `succeeded` directly under 200ms polling. Its OpenAPI specification types `status` as a bare string with no enumeration, so this package's status table records what was observed rather than what was promised, an unrecognized value keeps the job `running`, and an explicit `error` field is the trustworthy failure signal.

### Images are labelled by their bytes

The route's `response_format` names the encoding, not the image format, and it answers a request defaulting to PNG with JPEG. This package therefore sniffs each decoded image's leading bytes rather than assuming a type, and leaves an unrecognized signature as `application/octet-stream` instead of guessing.

### Native image downloads

Native results name Ark's `ark-content-generation-v2-ap-southeast-1.tos-ap-southeast-1.volces.com` or `ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com` CDN. Downloads accept only HTTPS on these exact hosts, refuse redirects, send no authorization header, and enforce `maxImageBytes` while reading the stream. DeepInfra's bearer remains on `api.deepinfra.com`; returned image bytes determine the media type and actual dimensions.

### Compatible image controls

The compatible route requires explicit `WIDTHxHEIGHT` and ignores unknown fields. Resolution tiers and multiple references are refused for models outside the native Seedream set; seed, guidance, output format and prompt optimization are also refused there rather than silently ignored.

### Retrieving bytes

`fetchVideo` reads the route's own content endpoint, which proxies the raw bytes. The job body's `data[].url` names whichever upstream vendor served the model — an observed job pointed at a third-party CDN — so an egress allowlist over those hosts would be unbounded. Retrieving through DeepInfra keeps egress on one pinnable origin. The clip is size-capped twice, on the declared `Content-Length` and again on the received bytes.

### Source map

- `src/index.ts` — config, credential resolution, the status table, the media-type sniffer, and both providers.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumer that mounts the media seam; this provider registers no tool and contributes no prompt.

#### KV Cache effect

No direct invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the provider is a poor fit. They are current package constraints.

- **No invariant companion** — No runtime invariant companion is published because this package owns no relationship two independent observers could disagree about; both registrations are disposed with the calling fiber and covered by the package's tests.
- **The status vocabulary is observed, not documented** — DeepInfra enumerates no job states, so a value outside the recorded table is treated as still running. A state it adds meaning "terminal" would be polled until a caller's own deadline.
- **No model catalog** — the model id passes through verbatim. Which DeepInfra models generate video is discoverable from its `video-gen` tag, but this package does not read that listing.
- **`resolution` and `generateAudio` are not forwarded** — the video route documents neither, so the seam's fields are dropped rather than sent and ignored.
- **Only the first reference image is used** — the route takes one first-frame `image_url`, so additional references a caller supplies are silently unused.
- **No webhook support** — DeepInfra recommends webhooks over polling for long jobs; this provider polls only.
- **No cost reporting** — per-second pricing is published on the model listing, not on a job, and the seam has nowhere to carry it.
- **Seed is not reproducibility** — Seedream 4 and 4.5 accept the provider's seed field; identical seeds do not guarantee identical bytes.
- **Ark-only switches are unavailable** — DeepInfra does not expose `watermark`, `sequential_image_generation` or `max_images`. `n` performs separate generations and does not create a native story or variation set.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Native video inference

DeepInfra's native route also returns videos inline as `data:` URIs. The video provider retains its submit/poll/retrieve path, whose status and cancellation methods match the media seam.

</details>
