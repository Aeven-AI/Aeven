/**
 * Grok Imagine shared types and constants.
 * Prefer the facade `../grok-imagine.ts` for public imports.
 */

import type { MediaArtifactMeta, MediaStore } from '../media-store.ts'

/** xAI developer API origin; authenticates only a pay-as-you-go `xai-*` key. */
export const XAI_API_ORIGIN = 'https://api.x.ai'
/**
 * Grok Build chat-proxy origin. Imagine is a SuperGrok subscription feature
 * reachable here with the same OAuth bearer the chat route uses, which is the
 * route the official `@xai-official/grok` CLI takes; `api.x.ai` is the separate
 * developer API and authenticates only a pay-as-you-go `xai-*` key.
 */
export const GROK_BUILD_IMAGINE_ORIGIN = 'https://cli-chat-proxy.grok.com'
/** Image generation path, the same on both Imagine origins. */
export const GROK_IMAGINE_IMAGE_PATH = '/v1/images/generations'
/** Video generation start path, the same on both Imagine origins. */
export const GROK_IMAGINE_VIDEO_START_PATH = '/v1/videos/generations'
/** Image model id on the developer API (`api.x.ai`). */
export const GROK_IMAGINE_IMAGE_MODEL = 'grok-imagine-image-2.0'
/** Image model the chat-proxy route names; `api.x.ai` keeps its own id. */
export const GROK_BUILD_IMAGINE_IMAGE_MODEL = 'grok-imagine-image-quality'
/** Video model id on both Imagine origins. */
export const GROK_IMAGINE_VIDEO_MODEL = 'grok-imagine-video-1.5'

/** Which upstream one Imagine call is authorized against. */
export type ImagineTransportId = 'xai-api' | 'grok-build'

/** Frozen Imagine API origins. Callers cannot widen this set. */
export const IMAGINE_API_ORIGINS: ReadonlySet<string> = new Set([XAI_API_ORIGIN, GROK_BUILD_IMAGINE_ORIGIN])

/** One resolved Imagine call credential and the upstream it authorizes. */
export interface ImagineCredential {
  /** Bearer token sent as `Authorization: Bearer <token>`. */
  readonly token: string
  /** Upstream this token authorizes. Defaults to `xai-api` for a bare string. */
  readonly transport: ImagineTransportId
  /** Additional request headers the upstream requires, already redaction-safe. */
  readonly headers?: Readonly<Record<string, string>>
}

/** Model-visible name of the Imagine image tool. */
export const GROK_IMAGINE_IMAGE_TOOL = 'grok_imagine_image'
/** Model-visible name of the Imagine video start tool. */
export const GROK_IMAGINE_VIDEO_TOOL = 'grok_imagine_video'
/** Model-visible name of the Imagine video status tool. */
export const GROK_IMAGINE_VIDEO_STATUS_TOOL = 'grok_imagine_video_status'

/** Same-origin route prefix that serves a stored Imagine image by attachment id. */
export const IMAGINE_IMAGE_ROUTE_PREFIX = '/plugins/dsh-grok-build/imagine/images/'

/** Frozen xAI output hosts. Callers cannot widen this list. */
export const XAI_OUTPUT_HOSTS = ['imgen.x.ai', 'videogen.x.ai', 'vidgen.x.ai'] as const

/** Image resolutions the Imagine API accepts. */
export const IMAGINE_IMAGE_RESOLUTIONS = ['1k', '2k'] as const
/** Video resolutions the Imagine API accepts. */
export const IMAGINE_VIDEO_RESOLUTIONS = ['480p', '720p', '1080p'] as const
/** Image aspect ratios the Imagine API accepts; `auto` lets the model choose. */
export const IMAGINE_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '3:4',
  '4:3',
  '9:16',
  '16:9',
  '2:3',
  '3:2',
  '9:19.5',
  '19.5:9',
  '9:20',
  '20:9',
  '1:2',
  '2:1',
  'auto',
] as const
/** Video aspect ratios the Imagine API accepts. */
export const IMAGINE_VIDEO_ASPECT_RATIOS = ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3'] as const
/** Shortest video the API generates, in seconds. */
export const IMAGINE_VIDEO_MIN_DURATION_SECONDS = 1
/** Longest video the API generates, in seconds. */
export const IMAGINE_VIDEO_MAX_DURATION_SECONDS = 15
/** Most images one generation call may request. */
export const IMAGINE_IMAGE_MAX_N = 10

/**
 * Hard ceilings enforced both at the tool boundary (consumer guard) and inside
 * the Imagine client (defence-in-depth). The prompt ceiling uses UTF-16 code
 * units because that is what the JSON wire format bounds; the image-id arrays
 * are bounded so a runaway caller cannot exhaust the bounded body reader.
 */
export const IMAGINE_PROMPT_MAX_LENGTH = 4000
/** Fewest reference image ids an edit accepts. */
export const IMAGINE_IMAGE_IDS_MIN = 1
/** Most reference image ids an edit accepts. */
export const IMAGINE_IMAGE_IDS_MAX = 5

/** Ceiling for one downloaded or decoded image, in bytes. */
export const DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES = 5 * 1024 * 1024
/**
 * Image generation on the subscription route is proxied through the Grok Build
 * chat proxy and regularly runs past a half-minute, so the default ceiling is
 * the slow route's, not the direct xAI API's. Deployments narrow it through
 * `imagineApiTimeoutMs`.
 */
export const DEFAULT_API_TIMEOUT_MS = 180_000
/** Deadline for downloading one generated image, in milliseconds. */
export const DEFAULT_IMAGE_DOWNLOAD_TIMEOUT_MS = 15_000
/** Deadline for downloading one generated video, in milliseconds. */
export const DEFAULT_VIDEO_DOWNLOAD_TIMEOUT_MS = 60_000
/** Most redirects a media download follows, each revalidated against the output-host allowlist. */
export const DEFAULT_MAX_REDIRECTS = 3
/** Ceiling for a developer-API JSON response, whose rows carry only signed URLs. */
export const DEFAULT_API_JSON_MAX_BYTES = 1024 * 1024
/**
 * Ceiling for a response that carries the image bytes inline. The chat-proxy
 * route answers with `b64_json`, so the envelope holds base64 (4 bytes per 3)
 * of up to {@link DEFAULT_IMAGE_DOWNLOAD_MAX_BYTES} per image for as many
 * images as the capability's `imageCount` allows, plus JSON overhead: 5 MiB ×
 * 4 × 4/3 ≈ 27 MiB. The developer API keeps the 1 MiB ceiling because its rows
 * carry only signed URLs.
 */
export const DEFAULT_INLINE_API_JSON_MAX_BYTES = 32 * 1024 * 1024
/** Most video job results the client keeps for status calls; the oldest is evicted first. */
export const MAX_CACHED_VIDEO_JOBS = 256

/** One Imagine call kind; credential resolution is asked per operation. */
export type ImagineOperation = 'image.generate' | 'video.start' | 'video.status'
/** One of {@link IMAGINE_IMAGE_RESOLUTIONS}. */
export type ImagineImageResolution = (typeof IMAGINE_IMAGE_RESOLUTIONS)[number]
/** One of {@link IMAGINE_VIDEO_RESOLUTIONS}. */
export type ImagineVideoResolution = (typeof IMAGINE_VIDEO_RESOLUTIONS)[number]
/** One of {@link IMAGINE_IMAGE_ASPECT_RATIOS}. */
export type ImagineImageAspectRatio = (typeof IMAGINE_IMAGE_ASPECT_RATIOS)[number]
/** One of {@link IMAGINE_VIDEO_ASPECT_RATIOS}. */
export type ImagineVideoAspectRatio = (typeof IMAGINE_VIDEO_ASPECT_RATIOS)[number]

/** A bare string keeps the historical `api.x.ai` key contract. */
export type ImagineApiKeyResolver = (operation: ImagineOperation) => Promise<string | ImagineCredential>

/** `fetch` signature the API calls use; a test seam, never used for media downloads. */
export type ImagineFetch = (input: string | URL, init?: RequestInit) => Promise<Response>

/** Resolve a hostname to its addresses, for the SSRF guard's pinning. */
export type ImagineDnsLookup = (hostname: string) => Promise<readonly string[]>

/** Image media types Imagine stores and serves. */
export type ImagineImageMediaType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'

/** Limits and cancellation for one media download hop. */
export interface ImagineMediaHopRequest {
  timeoutMs: number
  maxBytes: number
  accept: string
  signal?: AbortSignal
}

/** One media download hop's answer: a redirect target, or the body with its content type. */
export interface ImagineMediaHop {
  status: number
  location?: string
  contentType?: string
  data?: Uint8Array
}

/** Single-hop GET. Must not follow redirects or attach credentials. */
export interface ImagineMediaTransport {
  get(url: URL, request: ImagineMediaHopRequest): Promise<ImagineMediaHop>
}

/** One media download: the signed URL plus its time, size, and `Accept` limits. */
export interface ImagineDownloadRequest {
  url: string
  timeoutMs: number
  maxBytes: number
  accept: string
  signal?: AbortSignal
}

/** A completed media download. */
export interface ImagineDownloadResult {
  data: Uint8Array
  contentType?: string
}

/** Full download including redirect revalidation. Production default is pinned. */
export interface ImagineDownloader {
  download(request: ImagineDownloadRequest): Promise<ImagineDownloadResult>
}

/** Stable, secret-free failure class of an Imagine call. */
export type GrokImagineErrorCode =
	| 'MISSING_CREDENTIAL'
	| 'AUTH'
	| 'QUOTA'
	| 'RATE_LIMIT'
	| 'SSRF'
	| 'INVALID_INPUT'
	| 'UPSTREAM'
	| 'TIMEOUT'
	| 'MEDIA'

/** Secret-free Imagine failure; `code` classifies it and `status` carries the upstream HTTP status when one exists. */
export class GrokImagineError extends Error {
  /** Failure class callers branch on. */
  readonly code: GrokImagineErrorCode
  /** Upstream HTTP status, when the failure came from a response. */
  readonly status?: number

  constructor(code: GrokImagineErrorCode, message: string, options?: { cause?: unknown; status?: number }) {
    super(message, options)
    this.name = 'GrokImagineError'
    this.code = code
    if (options?.status !== undefined) this.status = options.status
  }
}

/** Reference to a stored image attachment, as the attachment store returns it. */
export interface ImagineImageAttachmentRef {
  attachmentId: string
  mediaType: ImagineImageMediaType
  bytes: number
  width: number
  height: number
  name?: string
}

/** The attachment store's image limits, when it declares any. */
export interface ImagineImageLimits {
  maxImageBytes?: number
  mediaTypes?: readonly string[]
}

/** Structural AttachmentStore surface used by Imagine. */
export interface ImagineAttachmentStore {
  imageLimits?: ImagineImageLimits
  saveImage(input: {
    data: Uint8Array
    mediaType: ImagineImageMediaType
    name?: string
  }): Promise<ImagineImageAttachmentRef>
  readImage?(
    ref: ImagineImageAttachmentRef,
    signal?: AbortSignal,
  ): Promise<{ ref: ImagineImageAttachmentRef; data: Uint8Array }>
}

/** One image generation request, before resolution and aspect validation. */
export interface GenerateImagineImageInput {
  prompt: string
  model?: string
  n?: number
  aspectRatio?: string
  resolution?: string
  name?: string
}

/** Stored output of one image generation; `attachment` and `path` repeat the first image. */
export interface ImagineImageResult {
  model: string
  images: readonly ImaginePersistedImage[]
  attachment: ImagineImageAttachmentRef
  path: string
}

/** One generated image: its attachment reference and on-disk path. */
export interface ImaginePersistedImage {
  attachment: ImagineImageAttachmentRef
  path: string
}

/** One video generation request, before duration, resolution, and aspect validation. */
export interface StartImagineVideoInput {
  prompt: string
  model?: string
  duration?: number
  aspectRatio?: string
  resolution?: string
  name?: string
}

/** A started video job; poll it by `requestId`. */
export interface ImagineVideoStartResult {
  model: string
  requestId: string
  status: 'pending'
}

/** Lifecycle state of a video job. */
export type ImagineVideoJobStatus = 'pending' | 'completed' | 'failed'

/** A video job's state; a completed job carries the stored artifact and its path. */
export interface ImagineVideoStatusResult {
  requestId: string
  status: ImagineVideoJobStatus
  artifact?: MediaArtifactMeta
  path?: string
  error?: string
}

/** Dependencies and limits for {@link GrokImagineClient}; every limit defaults to the matching `DEFAULT_*` constant. */
export interface GrokImagineClientOptions {
  resolveApiKey: ImagineApiKeyResolver
  attachments: ImagineAttachmentStore
  media: MediaStore
  /** API-only test seam. Never used for media and never a production default. */
  fetch?: ImagineFetch
  /** Media downloads. Production default pins DNS at connect time via undici. */
  downloader?: ImagineDownloader
  now?: () => number
  imageDownloadTimeoutMs?: number
  videoDownloadTimeoutMs?: number
  apiTimeoutMs?: number
  maxRedirects?: number
  imageMaxBytes?: number
  apiJsonMaxBytes?: number
  /** Envelope ceiling for the `grok-build` route, whose rows inline base64. */
  inlineApiJsonMaxBytes?: number
}

/** Response headers that serve a stored image to the browser. */
export interface ImagineImageDownloadHeaders {
  'Content-Type': string
  'Content-Length': string
  'Content-Disposition': string
  'Cache-Control': string
  'X-Content-Type-Options': 'nosniff'
}

/** A stored image ready to serve: its reference, bytes, and headers. */
export interface ImagineImageDownloadView {
  ref: ImagineImageAttachmentRef
  body: Uint8Array
  headers: ImagineImageDownloadHeaders
}

/**
 * Safe official-xAI request-id pattern: ASCII letters, digits, dashes, and
 * underscores. Limited to 256 characters. Public boundary validator.
 */
export const VIDEO_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,256}$/
/** {@link XAI_OUTPUT_HOSTS} as a set, for membership checks. */
export const FROZEN_OUTPUT_HOSTS = new Set<string>(XAI_OUTPUT_HOSTS)
/** {@link IMAGINE_IMAGE_RESOLUTIONS} as a set, for membership checks. */
export const IMAGE_RESOLUTION_SET = new Set<string>(IMAGINE_IMAGE_RESOLUTIONS)
/** {@link IMAGINE_VIDEO_RESOLUTIONS} as a set, for membership checks. */
export const VIDEO_RESOLUTION_SET = new Set<string>(IMAGINE_VIDEO_RESOLUTIONS)
/** {@link IMAGINE_IMAGE_ASPECT_RATIOS} as a set, for membership checks. */
export const IMAGE_ASPECT_SET = new Set<string>(IMAGINE_IMAGE_ASPECT_RATIOS)
/** {@link IMAGINE_VIDEO_ASPECT_RATIOS} as a set, for membership checks. */
export const VIDEO_ASPECT_SET = new Set<string>(IMAGINE_VIDEO_ASPECT_RATIOS)
