# Agent Note: Generated-media capability seam

Status: implemented

English | [中文](2026-09-03-generated-media-capability-seam.zh.md)

## Problem

Image generation existed in the harness only as vendor-specific tool code living outside it. A third-party plugin carried two independent implementations — one for Codex images, one for Grok Imagine — each with its own HTTP client, its own artifact store, its own retention policy, and its own tool surface. Adding a third provider meant a third copy of all four.

Video had no implementation anywhere, and the providers a deployment would actually reach for were unreachable: `avn-llm` speaks chat completions, and the DeepInfra chat route deliberately filters its catalog to `requireTags: ['chat']` because the same document lists image, video, speech, and embedding models the route cannot call. A user asking why DeepInfra's video models never appear in the model picker is asking for a capability the harness does not have, not for a filter to be relaxed.

## Decision

**Generated media is a capability seam, not a tool.** `ctx.media` owns provider registries, selection, the job contract, and the error taxonomy; providers own protocols and credentials; a consumer owns whatever a model sees. Image and video share one seam for the reason search and fetch do in `avn-web` — they share provider identity, credentials, cancellation, and errors, and splitting them would duplicate all four.

**The video status union is `running | succeeded | failed`, and providers map onto it.** The vocabulary follows OpenRouter's because it is the only surveyed provider that enumerates its own. The mapping is load-bearing rather than cosmetic: DeepInfra reports `queued` for a job that is actively rendering and publishes no running value at all — three observed jobs, including a 10-second clip taking 27.6s, went `queued` → `succeeded` directly under 200ms polling. An adapter that read `queued` as "not yet started" would mis-report every job it ever ran. The seam's states describe what a caller can do next, not what an upstream chose to call them.

**Bytes are retrieved through the provider's own content route, never a URL a job body carries.** A broker's job body names whichever upstream actually served the model — DeepInfra's named `api.pruna.ai` — so an egress allowlist over those hosts is unbounded and unpinnable. Both surveyed providers proxy the bytes themselves (`Content-Type: video/mp4`, verified against a real clip), which keeps egress at hosts the deployment already trusts. This is why `fetchVideo` exists as a seam method rather than callers reading `job.data[].url`.

**Selection resolves per call and never guesses.** Request-named provider, then configured provider, then the single usable one; every other case is a coded failure. Polling and fetching route by the provider named in the job rather than re-running selection, so a job cannot drift to another backend between poll and fetch, and mounting a second provider cannot silently redirect calls that already worked.

## Consequences

A new provider is one package implementing `MediaImageProvider` or `MediaVideoProvider`; it inherits selection, cancellation, the job contract, and the error taxonomy. The plugin's two private implementations become providers behind this seam rather than parallel tool stacks, which retires three of the four duplicated concerns.

The seam deliberately stores nothing and polls nothing. A consumer decides how long an artifact lives and at what cadence a job is watched, so a tool can surface progress instead of blocking inside the service. That leaves persistence unowned until the first consumer ships, which is the intended sequence rather than an oversight.

`MediaVideoStatus` is a closed union. Adding a state is a compile-enforced change across every provider, which is the point: a provider cannot quietly introduce a fourth state that consumers silently mishandle.

## Verification

Unit coverage is 100% on statements, branches, functions, and lines: duplicate registration per kind, disposal with the fiber, each selection outcome including the missing-versus-unusable distinction, request-over-config precedence, job routing by the job's own provider, cancellation forwarding, and the failure when a job's provider has been disposed. The status mapping and the content-route decision were established against the live APIs before the types were written, not inferred from documentation — DeepInfra's own OpenAPI spec types `status` as a bare `string` with no enum and declares `/content` as `application/json`, both of which the live calls contradicted.

## Alternatives considered

**Relax the DeepInfra chat catalog's `requireTags: ['chat']` filter.** Rejected: it would advertise video models on a route whose protocol cannot invoke them, so selecting one would fail at the transport. The filter is correct; the missing capability is elsewhere.

**Extend `avn-llm` with image and video methods.** Rejected because the shapes do not fit. Chat is a stream, image generation is a request/response, and video is a job with independent polling and retrieval. Widening the LLM adapter to hold all three would force every existing adapter to carry methods it cannot implement.

**One seam per medium.** Rejected: the two would share provider identity, credentials, selection, cancellation, and the error taxonomy, and both surveyed providers serve both media from one account and one base URL.

**Model the seam on the plugin's existing Imagine client.** Rejected as too narrow. That client pins one origin, one model id per medium, and a fixed output-host allowlist — assumptions that hold for one vendor and break for a broker.
