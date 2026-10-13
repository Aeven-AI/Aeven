/**
 * Vocabulary for the generated-media capability seam (`ctx.media`). Image and
 * video share one seam because they share provider identity, credentials,
 * cancellation, and the error taxonomy; they keep separate request and result
 * types because only video is a job.
 * @module @aeven/media/types
 */

import type { ImageAttachmentRef } from '@aeven/attachment'

import { HarnessError } from '@aeven/llm'

/** Failure codes callers may branch on. */
export type MediaErrorCode =
  /** Two providers claimed the same id. */
  | 'MEDIA_DUPLICATE_PROVIDER'
  /** A configured provider id names nothing registered. */
  | 'MEDIA_PROVIDER_CONFIGURED_MISSING'
  /** A configured provider is registered but reports itself unusable. */
  | 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE'
  /** No id was configured and several usable providers could serve the call. */
  | 'MEDIA_PROVIDER_AMBIGUOUS'
  /** No id was configured and no usable provider exists. */
  | 'MEDIA_PROVIDER_UNAVAILABLE'
  /** The provider rejected the request as malformed or unsupported. */
  | 'MEDIA_INVALID_REQUEST'
  /** The provider or its upstream failed the generation. */
  | 'MEDIA_UPSTREAM'

/** One media capability failure, carrying a code consumers may branch on. */
export class MediaError extends HarnessError {
  /**
   * @param message - human-readable, already free of credentials.
   * @param code - the branchable failure code.
   * @param options - standard error options, carrying `cause` where one exists.
   */
  constructor(message: string, code: MediaErrorCode, options?: ErrorOptions) {
    super(message, code, options)
    this.name = 'MediaError'
  }
}

/** Bytes one generation produced, already retrieved from the provider. */
export interface GeneratedMedia {
  /** IANA media type reported by the provider, e.g. `image/png`, `video/mp4`. */
  readonly mediaType: string
  /** The complete artifact. Providers return bytes, never a URL a caller must fetch. */
  readonly data: Uint8Array
}

/** A reference image supplied with a request, for image-to-image or image-to-video. */
export interface MediaImageReference {
  readonly mediaType: string
  readonly data: Uint8Array
}

/** A background an image model can generate, where its catalog offers the option. */
export type MediaImageBackground = 'transparent' | 'opaque'

/**
 * What one image generation asks for. `model` is the provider's own model id;
 * the seam never rewrites it, so a provider's catalog is the authority on what
 * is valid. Optional fields are passed through only when the provider supports
 * them — a provider that cannot honor one rejects the request rather than
 * silently producing something else.
 */
export interface MediaImageRequest {
  /** Provider route id. Omitted = resolve by the single usable provider. */
  readonly provider?: string
  /** The provider's model id, verbatim. */
  readonly model: string
  readonly prompt: string
  /** How many images to return. Omitted = the provider's own default. */
  readonly n?: number
  /** Aspect ratio in `W:H` form, e.g. `16:9`. */
  readonly aspectRatio?: string
  /** Named resolution, e.g. `1080p`, `2K`. */
  readonly resolution?: string
  /** Exact pixel size in `WIDTHxHEIGHT` form. */
  readonly size?: string
  /** Provider generation seed; reproducibility depends on the model. */
  readonly seed?: number
  /** Reference images for image-to-image work, in the order the prompt refers to them. */
  readonly references?: readonly MediaImageReference[]
  /** Background to generate. Omitted = the model's own choice. */
  readonly background?: MediaImageBackground
  /** Named quality tier the provider understands, e.g. `high`. Omitted = the provider's own choice. */
  readonly quality?: string
  /** Guidance strength, where the model exposes it. */
  readonly guidanceScale?: number
  /** Image file format, where the model exposes it. */
  readonly outputFormat?: 'png' | 'jpeg'
  /** Prompt optimization mode, where the model exposes it. */
  readonly optimizePromptMode?: 'standard' | 'fast'
}

/**
 * One image a generation produced.
 *
 * The two forms exist because providers differ in where the bytes land, not in
 * what they produce. A provider speaking a plain HTTP route holds bytes and
 * nothing else, so it yields `bytes` and lets the caller store them. A provider
 * that already writes through `ctx.attachments` — because it downloads under
 * its own size and host controls, or serves the result on its own route —
 * yields `attachment`, and re-reading and re-storing those bytes would gain the
 * caller nothing.
 */
export type GeneratedImage =
  /** Bytes the caller must store. */
  | { readonly kind: 'bytes'; readonly mediaType: string; readonly data: Uint8Array }
  /** An image the provider already stored durably. */
  | { readonly kind: 'attachment'; readonly attachment: ImageAttachmentRef }

/** One completed image generation. */
export interface MediaImageResult {
  /** The provider that served the call. */
  readonly provider: string
  /** The model that produced the images, as the provider reported it. */
  readonly model: string
  /** The generated images, in provider order. */
  readonly images: readonly GeneratedImage[]
  /**
   * What the caller's account was charged for the call, in millionths of a US
   * dollar, where the provider reports it. Omitted where it reports none.
   */
  readonly costUsdMicros?: number
}

/**
 * What one video generation asks for. Video is always a job: this request
 * starts one and returns immediately.
 */
export interface MediaVideoRequest {
  /** Provider route id. Omitted = resolve by the single usable provider. */
  readonly provider?: string
  /** The provider's model id, verbatim. */
  readonly model: string
  readonly prompt: string
  /** Clip length in seconds. Omitted = the provider's own default. */
  readonly duration?: number
  readonly aspectRatio?: string
  readonly resolution?: string
  readonly size?: string
  readonly seed?: number
  /** Whether to generate an audio track, where the model offers one. */
  readonly generateAudio?: boolean
  /** First-frame or reference images for image-to-video work. */
  readonly references?: readonly MediaImageReference[]
}

/**
 * Where one video job stands.
 *
 * The union is the vocabulary OpenRouter documents, because it is the only
 * provider that enumerates its own. Providers map onto it rather than the seam
 * carrying every provider's spelling: DeepInfra reports `queued` for a job that
 * is actively rendering and never publishes a running value, so its adapter
 * maps `queued` to `running` — the seam's states describe what a caller can do
 * next, not what an upstream chose to call them.
 */
export type MediaVideoStatus =
  /** Accepted and not finished. A caller polls again. */
  | 'running'
  /** Finished; the bytes are retrievable. */
  | 'succeeded'
  /** Terminal failure; `error` carries the reason. */
  | 'failed'

/** One video job's state, as the seam reports it. */
export interface MediaVideoJob {
  /** The provider that owns this job. */
  readonly provider: string
  /** Opaque job id, meaningful only to its own provider. */
  readonly id: string
  readonly status: MediaVideoStatus
  /** Present only on `failed`; already free of credentials. */
  readonly error?: string
  /**
   * What the caller's account was charged for the job, in millionths of a US
   * dollar. Present only on `succeeded`, and only where the provider reports it.
   */
  readonly costUsdMicros?: number
}

/** What every media provider declares, whichever kinds it serves. */
export interface MediaProvider {
  /** Registry key and the id a request names. */
  readonly id: string
  /** Whether this provider can serve a call right now, e.g. holds a credential. */
  available(): boolean
}

/** One image model a provider can serve, as its own catalog reports it. */
export interface MediaImageModel {
  /** Provider route id that serves this model. */
  readonly provider: string
  /** The provider's model id, verbatim — what a request must name. */
  readonly id: string
  /** Human-readable name where the catalog states one; otherwise the id stands alone. */
  readonly label?: string
  /** One-line note a menu can show beside the label. */
  readonly description?: string
}

/** A provider that generates images. */
export interface MediaImageProvider extends MediaProvider {
  /**
   * Generate images and return their bytes.
   * @param request - the prompt and generation controls.
   * @param signal - cancellation forwarded from the caller.
   * @returns the generated images.
   */
  generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult>
  /**
   * Every image model this provider serves.
   *
   * Optional: a provider whose route publishes no model document omits it, and
   * a caller building a menu simply lists nothing for that provider rather than
   * failing. A provider serving a fixed model returns that one entry.
   * @param signal - cancellation forwarded from the caller.
   * @returns the provider's image models.
   */
  listImageModels?(signal?: AbortSignal): Promise<readonly MediaImageModel[]>
}

/**
 * A provider that generates video as a job.
 *
 * `fetchVideo` retrieves bytes through the provider's own content route rather
 * than any URL a job body carries: a broker's job body can name an arbitrary
 * upstream CDN, and an allowlist over those is unbounded. Fetching through the
 * provider keeps egress pinned to the provider's own host.
 */
export interface MediaVideoProvider extends MediaProvider {
  /**
   * Start one video job.
   * @param request - the prompt and generation controls.
   * @param signal - cancellation forwarded from the caller.
   * @returns the accepted job, normally `running`.
   */
  startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob>
  /**
   * Read one job's current state.
   * @param jobId - the id this provider issued.
   * @param signal - cancellation forwarded from the caller.
   * @returns the job's state now.
   */
  videoStatus(jobId: string, signal?: AbortSignal): Promise<MediaVideoJob>
  /**
   * Retrieve a succeeded job's bytes from the provider's own content route.
   * @param jobId - the id this provider issued.
   * @param signal - cancellation forwarded from the caller.
   * @returns the finished clip.
   */
  fetchVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia>
}
