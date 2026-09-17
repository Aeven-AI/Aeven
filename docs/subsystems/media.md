# Generated Media

English | [中文](media.zh.md)

The generated-media seam — a [capability seam](../../.agents/notes/implemented/architecture/2026-09-03-generated-media-capability-seam.md) that spans **two media** (image and video) on one `ctx.media` service: Service Definition ([avn-media](../../packages/media/media), `ctx.media` + the provider registries), Service Providers, and a Consumer that owns whatever a model sees. Generated media is **one optional capability**, not part of the agent-loop spine — so its vocabulary lives here, not in [core.md](core.md). Swapping a provider does not change how a caller asks for an image or a clip.

Source: [`packages/media/media/src/types.ts`](../../packages/media/media/src/types.ts)

## Why one capability covers two media

Image and video share no request schema — only video is a job — but they are deliberately one `ctx.media` middle layer: one provider identity, one credential, one selection policy, one cancellation and error vocabulary. Both surveyed providers serve image and video from the same account and the same base URL, so splitting the seam would duplicate all of that to describe one vendor twice. The cost is the parallel image and video method groups on the service; that parallelism is intentional.

Providers register **capabilities** (a `MediaImageProvider` or `MediaVideoProvider`), not tools. Model-facing names, schemas, prompt guidance, and presentation belong to a consumer.

## Images

`generateImage()` takes a prompt, the provider's own model id verbatim, and optional generation controls — count, aspect ratio, resolution, exact size, seed, and reference images for image-to-image work. It returns `GeneratedMedia`: an IANA media type and the complete bytes. The seam never rewrites a model id, so a provider's catalog remains the authority on what is valid.

## Video is a job

Every surveyed provider treats video as asynchronous work, so the seam does too. `startVideo()` returns a `MediaVideoJob`; a caller polls `videoStatus()` until the job reports `succeeded`, then calls `fetchVideo()` for the bytes. The seam runs no polling loop of its own — a caller owns its cadence so a tool can surface progress rather than block inside the service.

`MediaVideoStatus` is `running | succeeded | failed`. It describes what a caller can do next, not what an upstream chose to call it. The vocabulary follows the one provider that enumerates its own; others map onto it. The mapping carries weight: a provider that reports a queued state for a job that is actively rendering, and publishes no running value at all, maps its queued state to `running`. Reading that state as "not yet started" would mis-report every job.

## Retrieving bytes

`fetchVideo` retrieves through the provider's own content route, never a URL a job body carries. A broker's job body names whichever upstream actually served the model, so an egress allowlist over those hosts is unbounded and unpinnable. Fetching through the provider keeps egress at hosts the deployment already trusts, and is why retrieval is a seam method rather than something callers do for themselves.

## Provider selection

Selection resolves per call, in one order: the request's own `provider`, then the configured `imageProvider` / `videoProvider`, then the single usable provider. Every other case is a coded failure rather than a silent pick, so mounting a second provider cannot quietly redirect calls that already worked. Polling and fetching route by the provider named in the job, never by re-running selection, so a job cannot drift to another backend between poll and fetch.

## Errors

Every failure is a `MediaError` carrying a `MediaErrorCode`. Selection failures distinguish a pinned provider that is absent (`MEDIA_PROVIDER_CONFIGURED_MISSING`) from one present but unusable (`MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE`), and an empty registry (`MEDIA_PROVIDER_UNAVAILABLE`) from an ambiguous one (`MEDIA_PROVIDER_AMBIGUOUS`), so a caller can tell a misconfiguration from a missing credential. A provider rejects a request it cannot honor with `MEDIA_INVALID_REQUEST`, and reports upstream failure as `MEDIA_UPSTREAM`.

## The service

`MediaRuntime` registers image and video providers, rejects duplicate ids per kind with `MEDIA_DUPLICATE_PROVIDER`, and resolves providers at execution time with structured selection errors. It stores nothing: persistence, retention, and any addressable route belong to the consumer that decides how long an artifact lives.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxmedia--mediaruntime"></a>

### `ctx.media` — `MediaRuntime`

The generated-media service, registered as `ctx.media`.

Selection precedence, resolved at execution time: the request's own `provider`, then the configured id, then the single usable provider. Every other case is a MediaError rather than a silent pick, so adding a second provider never quietly redirects existing calls.

```ts cordis-catalog
/**
 * Register an image provider.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters it, disposed with the calling fiber.
 */
registerImageProvider(provider: MediaImageProvider): () => void

/**
 * Register a video provider.
 * @param provider - the provider; its `id` is the registry key.
 * @returns the disposer that unregisters it, disposed with the calling fiber.
 */
registerVideoProvider(provider: MediaVideoProvider): () => void

/**
 * Every image model the registered providers serve, in registration order.
 *
 * A provider that publishes no catalog contributes nothing, and one whose
 * catalog call fails is skipped rather than failing the whole listing: a
 * menu built from three providers is more useful than an error because one
 * route was unreachable.
 * @param signal - cancellation forwarded to every provider.
 * @returns the models, grouped by provider in registration order.
 */
async listImageModels(signal?: AbortSignal): Promise<readonly MediaImageModel[]>

/**
 * Generate one image through the selected image provider.
 * @param request - the prompt, model, and generation controls; its `provider` names the route to use instead of the configured default.
 * @param signal - cancellation forwarded to the provider.
 * @returns the generated image.
 */
async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult>

/**
 * Start one video job through the selected provider.
 * @param request - the prompt, model, and generation controls.
 * @param signal - cancellation forwarded to the provider.
 * @returns the accepted job.
 */
async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob>

/**
 * Read one video job's state. The job's own provider is named by the job, so
 * polling never re-runs selection and cannot drift to another provider.
 * @param job - the job to poll, as returned by {@link startVideo}.
 * @param signal - cancellation forwarded to the provider.
 * @returns the job's state now.
 */
async videoStatus(job: MediaVideoJob, signal?: AbortSignal): Promise<MediaVideoJob>

/**
 * Retrieve a succeeded job's bytes.
 * @param job - the succeeded job.
 * @param signal - cancellation forwarded to the provider.
 * @returns the finished clip.
 */
async fetchVideo(job: MediaVideoJob, signal?: AbortSignal): Promise<GeneratedMedia>
```

Source: [`packages/media/media/src/index.ts`](../../packages/media/media/src/index.ts)
<!-- END GENERATED cordis-surface -->
