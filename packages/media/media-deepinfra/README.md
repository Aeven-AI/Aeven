---
description: "The DeepInfra image and video provider for ctx.media: OpenAI-compatible image generation and submit/poll/retrieve video jobs against one pinned origin, with DeepInfra's observed job states mapped onto the seam's union."
kind: "package-reference"
---

# @aeven/media-deepinfra

English | [中文](README.zh.md)

## Summary

`avn-media-deepinfra` registers DeepInfra as both an image and a video backend for `ctx.media`. Images go through DeepInfra's OpenAI-compatible route and come back as base64; video is a job — submit, poll, retrieve — against the same account and origin. DeepInfra brokers 16 models tagged `video-gen` at the time of writing, from Wan and Seedance to Veo, at per-second pricing. Mount it when a deployment wants both media from one DeepInfra key.

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

`id` is the registry key, `apiKeyEnv` is the credential reference, and `maxVideoBytes` caps one retrieved clip; all three default. The credential resolves through `ctx.credentials` when that service is mounted, and falls back to the named environment variable.

### Requests

Image requests carry the prompt, `n`, and `size`; the route documents base64 as its only supported response format, so that is always what is asked for. Video requests forward `duration` as `seconds`, plus `aspectRatio`, `size` and `seed`, and a single reference image becomes the `image_url` first frame for image-to-video.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### `queued` means running

DeepInfra reports `queued` for a job that is actively rendering and publishes no running value at all: three observed jobs, including a 10-second clip taking 27.6 seconds, went `queued` → `succeeded` directly under 200ms polling. Its OpenAPI specification types `status` as a bare string with no enumeration, so this package's status table records what was observed rather than what was promised, an unrecognized value keeps the job `running`, and an explicit `error` field is the trustworthy failure signal.

### Images are labelled by their bytes

The route's `response_format` names the encoding, not the image format, and it answers a request defaulting to PNG with JPEG. This package therefore sniffs each decoded image's leading bytes rather than assuming a type, and leaves an unrecognized signature as `application/octet-stream` instead of guessing.

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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: the legacy inference route

DeepInfra also exposes `POST /v1/inference/{model}`, which returns a clip inline as a `data:` URI rather than as a job. It may suit short clips where a job's polling overhead dominates, but it duplicates the transport and has no status vocabulary at all. Not pursued.

</details>
