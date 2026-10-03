# Agent Note: Generated-media providers

Status: implemented

English | [中文](2026-09-03-generated-media-providers.zh.md)

## Problem

The [media seam](2026-09-03-generated-media-capability-seam.md) shipped with no backends, so nothing could generate anything. The two providers a deployment would reach for — DeepInfra and OpenRouter — each serve both media from one account, and neither was reachable: `avn-llm` speaks chat completions, and pi-ai models images but no video at all.

## Decision

**Three provider packages, split by transport rather than by vendor.** `avn-media-pi-ai` registers pi-ai's images registry, which brings OpenRouter's image catalog with no hand-written client. `avn-media-openrouter` and `avn-media-deepinfra` speak the video APIs directly, and DeepInfra also carries its own images because its OpenAI-compatible route is a different transport from pi-ai's chat-modality path. The split keeps one package per protocol; a vendor served by two protocols appears in two packages, which is what OpenRouter does today.

**Every video provider retrieves bytes through its own content route.** Never a URL a job body carries. DeepInfra's job body named `api.pruna.ai` — whichever upstream actually served the model — so an egress allowlist over those hosts is unbounded. Both providers proxy the bytes themselves, which keeps egress at one pinnable origin each and is why `fetchVideo` exists on the seam rather than callers reading `job.data[].url`.

**A clip is size-capped twice: on the declared `Content-Length` and again on the received bytes.** A provider may under-declare, and the second check is the one that holds.

**Provider status vocabularies are recorded from observation, not from documentation.** OpenRouter enumerates its states, so its table is the documented set. DeepInfra enumerates none — its OpenAPI specification types `status` as a bare string — so its table records what three live jobs actually produced, `queued` maps to `running` because a job renders for its whole life in that state, an unrecognized value keeps polling, and the explicit `error` field is the only trustworthy failure signal.

**Images are labelled by their bytes.** DeepInfra's `response_format` names the encoding, not the image format, and it answers a PNG-defaulted request with JPEG. The provider sniffs each decoded image's signature and leaves an unrecognized one as `application/octet-stream` rather than guessing.

Native Seedream images use the credential-free, bounded CDN download described in [Seedream native image capabilities](../feature/2026-10-02-seedream-native-capabilities.md).

## Consequences

DeepInfra and OpenRouter each generate both image and video through one seam, with one credential each and no per-vendor code in any consumer. A fourth provider is one package implementing one or both provider contracts.

Splitting by transport means OpenRouter images and OpenRouter video live in different packages. That reads oddly by vendor and is recorded in both READMEs; the alternative — one package per vendor — would have put a pi-ai dependency and a hand-written HTTP client in the same package for no shared code.

Two providers now carry near-identical `fetchVideo` implementations: pinned origin, double size cap, media type from the response header. That duplication is deliberate for two providers and is the first thing to extract if a third video backend arrives.

Optional seam fields that a provider's route does not document are dropped rather than sent: pi-ai carries no `n`/`aspectRatio`/`seed`, DeepInfra's video route documents no `resolution`/`generateAudio`, and DeepInfra takes only the first reference image. Each is listed in its package's Known Limitations, because a silently ignored control is worse than an absent one.

## Verification

Unit coverage is 100% on statements, branches, functions, and lines across all three packages: request-field mapping under each route's own names, every status-table entry including the unknown-value and error-field paths, base64 decoding, media-type sniffing across five signatures, both size-cap paths, missing and empty credentials, credential-service precedence over the environment, and cancellation on every call.

The seam was then exercised end to end against the live APIs, mounting the real plugins rather than mocks: a DeepInfra image came back as a 1024×1024 JPEG and a video job ran `queued` → `succeeded` and returned a valid MP4, both verified with `file`. That run is what caught the hardcoded `image/png`, which no unit test written against the same assumption could have found.

## Alternatives considered

**One package per vendor.** Rejected: OpenRouter images arrive through pi-ai and OpenRouter video through a hand-written client, so a vendor package would hold two unrelated transports and a dependency only half of it needs.

**Call pi-ai's `generateImages` registry entry point.** Not possible: that module is absent from pi-ai's export map. The provider object returned by `openrouterImagesProvider()` carries its own `generateImages`, which also keeps model, auth, and transport resolved by one object.

**Trust `response_format: 'b64_json'` to imply PNG.** Rejected once a live call returned JPEG for a request that defaulted to PNG; the field names the encoding, not the format.

**Poll inside the provider until a job settles.** Rejected: a caller that owns its own cadence can surface progress, and a provider that blocks cannot. The seam's `videoStatus` reports once by design.
