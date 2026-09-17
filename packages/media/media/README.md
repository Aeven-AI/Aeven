---
description: "The generated-media service (ctx.media): how deployments and plugin authors generate images and video through interchangeable providers, with one selection policy, one job vocabulary, and one error taxonomy."
kind: "package-reference"
---

# @aeven/media

English | [中文](README.zh.md)

## Summary

Any plugin or tool can generate an image or a video clip through `avn-media` (`ctx.media`) without binding to a vendor's API. Image and video providers plug in as backends, and the service resolves one provider per call, so callers never track which vendor ran behind a generation. Choose it when building media tooling or another backend. The service itself makes no network calls and registers no model-facing tool: a provider must be mounted before anything can be generated. Image and video share one selection policy, one cancellation and error vocabulary, and one configuration surface, so "how this harness generates media" has a single owner.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

A composition that needs generated media loads the `avn-media` service and mounts at least one backend — an image provider, a video provider, or both — and plugin or tool authors then call `ctx.media.generateImage()`, `ctx.media.startVideo()`, `ctx.media.videoStatus()` and `ctx.media.fetchVideo()` directly.

### Images and video

`generateImage()` returns bytes. `startVideo()` returns a job, because every provider treats video as asynchronous work; a caller polls `videoStatus()` until the job reports `succeeded`, then calls `fetchVideo()` for the clip. Both operations return `GeneratedMedia` — an IANA media type and the complete artifact — so a caller never receives a URL it has to retrieve itself.

### Provider selection

Selection resolves per call, in one order: the request's own `provider`, then the configured `imageProvider` / `videoProvider`, then the single usable provider. Anything else fails with a code rather than a silent pick, so mounting a second provider cannot quietly redirect calls that already worked. Polling and fetching route by the provider named in the job, never by re-running selection, so a job cannot drift to a different backend between poll and fetch.

### Failures and recovery

Every failure is a `MediaError` carrying a `MediaErrorCode`. Selection failures distinguish a pinned provider that is absent (`MEDIA_PROVIDER_CONFIGURED_MISSING`) from one that is present but unusable (`MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE`), and an empty registry (`MEDIA_PROVIDER_UNAVAILABLE`) from an ambiguous one (`MEDIA_PROVIDER_AMBIGUOUS`), so a caller can tell a misconfiguration from a missing credential.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

### Design philosophy

The seam owns selection, vocabulary, and the job contract; providers own protocols and credentials. Image and video share a seam for the same reason search and fetch do in `avn-web`: they share provider identity, credentials, cancellation, and errors, and splitting them would duplicate all four.

### The video status union

`MediaVideoStatus` is `running | succeeded | failed`. It describes what a caller can do next, not what an upstream chose to call it. The vocabulary follows OpenRouter's because it is the only surveyed provider that enumerates its own; other providers map onto it. That mapping is not cosmetic — DeepInfra reports `queued` for a job that is actively rendering and publishes no running value at all, so its adapter maps `queued` to `running`. A provider that treated `queued` as "not yet started" would mis-report every job it ever ran.

### Retrieving bytes

`MediaVideoProvider.fetchVideo` retrieves through the provider's own content route rather than any URL a job body carries. A broker's job body can name an arbitrary upstream CDN — DeepInfra's names whichever underlying vendor served the model — and an egress allowlist over those is unbounded. Fetching through the provider keeps egress pinned to hosts the deployment already trusts.

### Source map

- `src/types.ts` — request, result, job, and provider vocabulary, plus `MediaError`.
- `src/index.ts` — the `MediaRuntime` service: registries, selection, and job routing.
- `src/bytes.ts` — the signature sniffing that labels generated image bytes.
- `src/vendor-route.ts` — the plumbing vendor adapters share: credential resolution, the JSON call and byte retrieval against one pinned origin, job-body translation, and the video provider assembled from a vendor's paths and request body.

<a id="model-experience"></a>
## Model Experience

Indirectly, through the consumer that mounts it; this service registers no tool, contributes no prompt, and is never named to a model.

#### KV Cache effect

No direct invalidation; the consumer owns any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

These limits define when the service is incomplete on its own. They are current package constraints.

- **No invariant companion** — No runtime invariant companion is published because the seam owns no relationship two independent observers could disagree about: the registries are private to one service instance, and selection is a pure function of them, so a check could only restate the code it guards.
- **No model catalog** — the seam takes a provider's model id verbatim and never validates it. Which models exist, and which of them generate video rather than chat, stays with the provider and its catalog configuration.
- **No storage** — the seam returns bytes and forgets them. Persistence, retention, and any addressable route belong to the consumer that decides how long an artifact lives.
- **No polling loop** — `videoStatus()` reports a job's state once. Callers own their own cadence, so a tool can surface progress rather than block inside the seam.
- **No cost or usage reporting** — providers report neither, so a caller cannot see what one generation cost.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: open questions and undecided directions. It is explicitly non-authoritative — shipped behavior, limits, and rationale live in the sections above.

#### Future: a model catalog

Providers know which of their models generate images and which generate video, and both surveyed providers tag them. Whether that belongs here as a catalog method, or stays in each provider's own configuration the way `avn-llm-pi-ai` handles chat catalogs, is undecided; the seam works without one because a caller already names its model.

</details>
