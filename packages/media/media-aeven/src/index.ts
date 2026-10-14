/**
 * Aeven gateway image and video providers for `ctx.media`. They serve Aeven's
 * two image models, `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro`, through
 * the gateway's `POST /v1/images/generations`, and its video model,
 * `Aeven-1.0-Video-Pro`, as a gateway job started with
 * `POST /v1/videos` and polled at `GET /v1/videos/{id}`. Every request presents
 * the signed-in user's Aeven session as the bearer, so generating needs a
 * sign-in and no vendor key.
 *
 * The catalogs are shipped rather than fetched. The gateway's `GET /v1/models`
 * answers with what one account's plan may use, which is the wrong input for a
 * menu every account reads; both models are always offered, and a refusal from
 * the gateway names what the account lacks.
 * @module @aeven/media-aeven
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/agent'
import { credentialRef } from '@aeven/credentials'
import type {} from '@aeven/credentials'
import type {} from '@aeven/identity-user'
import { imageMediaType, MediaError } from '@aeven/media'
import type {
  GeneratedImage,
  MediaErrorCode,
  MediaImageBackground,
  MediaImageModel,
  MediaImageProvider,
  MediaImageRequest,
  MediaImageResult,
  MediaVideoJob,
  MediaVideoProvider,
  MediaVideoRequest,
  MediaVideoStatus,
  GeneratedMedia,
} from '@aeven/media'
import type {} from '@aeven/session'

/** Cordis plugin name. */
export const name = 'media-aeven'
/** The media seam must exist before this provider can register into it. */
export const inject = ['media']

/** Registry key this provider claims under `ctx.media` by default. */
export const DEFAULT_PROVIDER_ID = 'aeven'
/** Aeven API origin used when the deployment names none; `/v1` is appended. */
export const DEFAULT_API_URL = 'http://localhost:9000'
/** Credential reference holding the signed-in Aeven session. */
export const DEFAULT_API_KEY_ENV = 'AEVEN_TOKEN'

/**
 * One Aeven image model and the request options the gateway accepts for it.
 *
 * Mirrors the gateway's catalogue entry (`GET /v1/models` lists the same
 * vocabulary under `image`); the gateway stays the authority and refuses
 * anything this list does not anticipate.
 */
export interface AevenImageModel {
  /** Aeven model id, sent verbatim. */
  readonly id: string
  /** Menu label. */
  readonly label: string
  /** One-line note naming what the model is for and the options it has. */
  readonly description: string
  /** Most images one request may ask for; the model's `description` states this count. */
  readonly maxImages: number
  /** Most reference images one request may supply. */
  readonly maxReferenceImages: number
  /** Backgrounds the model can generate; empty when it has no background option. */
  readonly backgrounds: readonly MediaImageBackground[]
  /** Whether the model takes a prompt guidance strength. */
  readonly guidanceScale: boolean
}

/** The model a deployment generates with when nothing else is chosen. */
export const DEFAULT_IMAGE_MODEL = 'Aeven-1.0-Image-Flash'

/** Aeven's image models, default first. */
export const AEVEN_IMAGE_MODELS: readonly AevenImageModel[] = [
  {
    id: 'Aeven-1.0-Image-Flash',
    label: 'Aeven Image Flash',
    description: 'Fast image generation and editing. Size 1K or 2K (default, the largest — no 4K), or WIDTHxHEIGHT for another aspect ratio, e.g. 2730x1536 for 16:9; up to 4 images per call; up to 14 reference images; seed. No guidance scale or background option.',
    maxImages: 4,
    maxReferenceImages: 14,
    backgrounds: [],
    guidanceScale: false,
  },
  {
    id: 'Aeven-1.0-Image-Pro',
    label: 'Aeven Image Pro',
    description: 'Highest-quality image generation and editing. Size 1K, 1.5K or 2K (default, the largest — no 4K), or WIDTHxHEIGHT; up to 4 images per call; four references; PNG/JPEG, background and standard/fast prompt optimization.',
    maxImages: 4,
    maxReferenceImages: 4,
    backgrounds: ['transparent', 'opaque'],
    guidanceScale: false,
  },
]

/**
 * One Aeven video model and the request options the gateway accepts for it.
 *
 * Mirrors the gateway's catalogue entry (`GET /v1/models` lists the same
 * vocabulary under `video`); the gateway stays the authority.
 */
export interface AevenVideoModel {
  /** Aeven model id, sent verbatim. */
  readonly id: string
  /** Menu label. */
  readonly label: string
  /** One-line note naming what the model is for and the options it has. */
  readonly description: string
  /** Output resolutions the model renders. */
  readonly resolutions: readonly string[]
  /** Aspect ratios the model renders, `adaptive` letting the model choose. */
  readonly aspectRatios: readonly string[]
  /** Shortest clip in seconds. */
  readonly minDuration: number
  /** Longest clip in seconds. */
  readonly maxDuration: number
  /** The only lengths the model renders, when it takes no length in between and no automatic length. */
  readonly durations?: readonly number[]
}

/** The video model a deployment generates with when nothing else is chosen. */
export const DEFAULT_VIDEO_MODEL = 'Aeven-1.0-Video-Flash'

/**
 * Aeven's video models, default first. Each description names the tier and what it renders,
 * never the vendor model serving it, which can change without renaming the tier.
 */
export const AEVEN_VIDEO_MODELS: readonly AevenVideoModel[] = [
  {
    id: 'Aeven-1.0-Video-Flash',
    label: 'Aeven Video Flash',
    description: 'Fast tier: quick and economical video from a text prompt, a first-frame image, or a first- and a last-frame image. Duration 4, 6 or 8 seconds only (default 8; no -1, nothing longer); resolution 720p, 1080p (default) or 4K; aspect ratio 16:9 (default) or 9:16; synchronized audio on by default, generate_audio false makes it cheaper; seed 0 or more. Use it unless the clip must be longer than 8 seconds or need another aspect ratio.',
    resolutions: ['720p', '1080p', '4K'],
    aspectRatios: ['16:9', '9:16'],
    minDuration: 4,
    maxDuration: 8,
    durations: [4, 6, 8],
  },
  {
    id: 'Aeven-1.0-Video-Pro',
    label: 'Aeven Video Pro',
    description: 'Slower, pricier tier with better quality: for clips longer than 8 seconds or other aspect ratios, from a text prompt or a starting image. Duration 4–15 seconds (default 5) or -1 to let the model decide; resolution 480p, 720p (default) or 1080p; aspect ratio 16:9 (default), 4:3, 1:1, 3:4, 9:16, 21:9 or adaptive; optional synchronized audio; a first-frame image and optionally a last-frame image; seed.',
    resolutions: ['480p', '720p', '1080p'],
    aspectRatios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'],
    minDuration: 4,
    maxDuration: 15,
  },
]

/** Default {@link Config.maxVideoBytes}: the local attachment store's default file ceiling. */
export const DEFAULT_MAX_VIDEO_BYTES = 50 * 1024 * 1024

/** Config for the Aeven media providers. */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `aeven`. */
  id?: string
  /** Aeven API origin; `/v1` is appended. Defaults to the development gateway. */
  apiUrl?: string
  /** Credential reference holding the signed-in session; defaults to `AEVEN_TOKEN`. */
  apiKeyEnv?: string
  /** Largest finished clip one download accepts, in bytes. */
  maxVideoBytes?: number
}

export const Config: z<Config> = z.object({
  id: z.string().default(DEFAULT_PROVIDER_ID),
  apiUrl: z.string().default(DEFAULT_API_URL),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
  maxVideoBytes: z.number().step(1).min(1).default(DEFAULT_MAX_VIDEO_BYTES),
})

/** One provider's fully resolved connection facts. */
export interface ResolvedConfig {
  /** Registry key under `ctx.media`. */
  readonly id: string
  /** The image generation endpoint. */
  readonly endpoint: string
  /** The video job collection: `POST` starts a job, `GET {endpoint}/{id}` reads one. */
  readonly videoEndpoint: string
  /** Credential reference holding the signed-in session. */
  readonly apiKeyEnv: string
  /** Largest finished clip one download accepts, in bytes. */
  readonly maxVideoBytes: number
}

/**
 * Resolve one entry's config to the facts every request uses.
 * @param config - the entry's config.
 * @returns the registry key, endpoints, credential reference, and download ceiling.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  const origin = (config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')
  return {
    id: config.id ?? DEFAULT_PROVIDER_ID,
    endpoint: `${origin}/v1/images/generations`,
    videoEndpoint: `${origin}/v1/videos`,
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
    maxVideoBytes: config.maxVideoBytes ?? DEFAULT_MAX_VIDEO_BYTES,
  }
}

/**
 * Find one shipped model by id.
 * @param id - the requested model id.
 * @returns the model, or undefined when Aeven serves no image model by that id.
 */
export function aevenImageModel(id: string): AevenImageModel | undefined {
  return AEVEN_IMAGE_MODELS.find(model => model.id === id)
}

/**
 * Build the gateway request body for one generation, refusing what the chosen
 * model cannot honor before any request is made.
 * @param request - the seam request.
 * @returns the JSON body for `POST /v1/images/generations`.
 */
export function requestBody(request: MediaImageRequest): Record<string, unknown> {
  const model = aevenImageModel(request.model)
  if (model === undefined) {
    throw new MediaError(
      `"${request.model}" is not an Aeven image model; use one of ${AEVEN_IMAGE_MODELS.map(entry => entry.id).join(', ')}`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  if (request.aspectRatio !== undefined) {
    throw new MediaError(
      `aspectRatio is not supported by ${model.id}; pass size as WIDTHxHEIGHT instead`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  if (request.background !== undefined && !model.backgrounds.includes(request.background)) {
    const offering = AEVEN_IMAGE_MODELS.filter(entry => entry.backgrounds.includes(request.background as MediaImageBackground))
    throw new MediaError(
      `${model.id} has no background option; a ${request.background} background needs ${offering.map(entry => entry.id).join(' or ')}`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  if (request.n !== undefined && (request.n < 1 || request.n > model.maxImages)) {
    throw new MediaError(`${model.id} generates 1 to ${String(model.maxImages)} images per call`, 'MEDIA_INVALID_REQUEST')
  }
  if (request.size !== undefined && request.resolution !== undefined) {
    throw new MediaError('Pass either size or resolution, not both', 'MEDIA_INVALID_REQUEST')
  }
  const references = request.references ?? []
  if (references.length > model.maxReferenceImages) {
    throw new MediaError(
      `${model.id} accepts at most ${String(model.maxReferenceImages)} reference images`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  return {
    model: model.id,
    prompt: request.prompt,
    // A `url` answer points at the vendor's expiring storage; bytes are what
    // the seam returns.
    response_format: 'b64_json',
    ...request.n === undefined ? {} : { n: request.n },
    ...request.size === undefined && request.resolution === undefined ? {} : { size: request.size ?? request.resolution },
    ...request.seed === undefined ? {} : { seed: request.seed },
    // A guidance strength only tunes how closely the prompt is followed, so a
    // model without one generates the same request without it rather than
    // failing the call.
    ...request.guidanceScale === undefined || !model.guidanceScale ? {} : { guidance_scale: request.guidanceScale },
    ...request.outputFormat === undefined ? {} : { output_format: request.outputFormat },
    ...request.optimizePromptMode === undefined ? {} : { optimize_prompt_mode: request.optimizePromptMode },
    ...request.background === undefined ? {} : { background: request.background },
    ...references.length === 0 ? {} : {
      image: references.map(reference => `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`),
    },
  }
}

/**
 * Find one shipped video model by id.
 * @param id - the requested model id.
 * @returns the model, or undefined when Aeven serves no video model by that id.
 */
export function aevenVideoModel(id: string): AevenVideoModel | undefined {
  return AEVEN_VIDEO_MODELS.find(model => model.id === id)
}

/**
 * Build the gateway request body that starts one video job, refusing what the
 * chosen model cannot honor before any request is made.
 *
 * Reference images travel as the clip's frames: the first is the first frame
 * and a second is the last frame. The gateway's `reference_images` field takes
 * only HTTPS or `asset://` URLs, which local bytes do not have.
 * @param request - the seam request.
 * @returns the JSON body for `POST /v1/videos`.
 */
export function videoRequestBody(request: MediaVideoRequest): Record<string, unknown> {
  const model = aevenVideoModel(request.model)
  if (model === undefined) {
    throw new MediaError(
      `"${request.model}" is not an Aeven video model; use one of ${AEVEN_VIDEO_MODELS.map(entry => entry.id).join(', ')}`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  if (request.size !== undefined) {
    throw new MediaError(`size is not supported by ${model.id}; pass resolution and aspectRatio instead`, 'MEDIA_INVALID_REQUEST')
  }
  if (request.duration !== undefined && model.durations !== undefined && !model.durations.includes(request.duration)) {
    throw new MediaError(
      `${model.id} renders only ${model.durations.join(', ')} seconds`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  if (request.duration !== undefined && model.durations === undefined && request.duration !== -1
    && (!Number.isInteger(request.duration) || request.duration < model.minDuration || request.duration > model.maxDuration)) {
    throw new MediaError(
      `${model.id} renders ${String(model.minDuration)} to ${String(model.maxDuration)} seconds, or -1 to let the model decide`,
      'MEDIA_INVALID_REQUEST',
    )
  }
  if (request.resolution !== undefined && !model.resolutions.includes(request.resolution)) {
    throw new MediaError(`${model.id} renders ${model.resolutions.join(', ')}`, 'MEDIA_INVALID_REQUEST')
  }
  if (request.aspectRatio !== undefined && !model.aspectRatios.includes(request.aspectRatio)) {
    throw new MediaError(`${model.id} renders aspect ratios ${model.aspectRatios.join(', ')}`, 'MEDIA_INVALID_REQUEST')
  }
  const references = request.references ?? []
  if (references.length > 2) {
    throw new MediaError(`${model.id} takes at most a first-frame and a last-frame image`, 'MEDIA_INVALID_REQUEST')
  }
  const frame = (index: number): string | undefined => {
    const reference = references[index]
    return reference === undefined
      ? undefined
      : `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`
  }
  const first = frame(0)
  const last = frame(1)
  return {
    model: model.id,
    prompt: request.prompt,
    ...request.duration === undefined ? {} : { duration: request.duration },
    ...request.resolution === undefined ? {} : { resolution: request.resolution },
    ...request.aspectRatio === undefined ? {} : { aspect_ratio: request.aspectRatio },
    ...request.seed === undefined ? {} : { seed: request.seed },
    ...request.generateAudio === undefined ? {} : { generate_audio: request.generateAudio },
    ...first === undefined ? {} : { first_frame_image: first },
    ...last === undefined ? {} : { last_frame_image: last },
  }
}

/** The gateway's job states, mapped onto the seam's. */
const VIDEO_STATUS: Readonly<Record<string, MediaVideoStatus>> = {
  in_progress: 'running',
  completed: 'succeeded',
  failed: 'failed',
}

/**
 * Read one gateway job document as the seam's job.
 * @param provider - the registry key that owns the job.
 * @param payload - the decoded `video.generation.job` body.
 * @returns the job's state.
 */
export function videoJob(provider: string, payload: unknown): MediaVideoJob {
  const body = typeof payload === 'object' && payload !== null
    ? payload as { id?: unknown; status?: unknown; error?: { message?: unknown } | null }
    : {}
  if (typeof body.id !== 'string' || body.id === '') {
    throw new MediaError('Aeven video job carried no id', 'MEDIA_UPSTREAM')
  }
  const status = typeof body.status === 'string' ? VIDEO_STATUS[body.status] : undefined
  if (status === undefined) {
    throw new MediaError(`Aeven video job reported unknown status ${JSON.stringify(body.status)}`, 'MEDIA_UPSTREAM')
  }
  if (status === 'running') return { provider, id: body.id, status }
  if (status === 'succeeded') {
    const cost = costOf((payload as { result?: unknown }).result)
    return { provider, id: body.id, status, ...cost === undefined ? {} : { costUsdMicros: cost } }
  }
  const message = typeof body.error?.message === 'string' ? body.error.message : 'the gateway reported no reason'
  return { provider, id: body.id, status, error: message }
}

/**
 * The charge a gateway answer reports under `usage.cost_usd_micros`: what the
 * gateway's ledger recorded against the caller's account for the request.
 * @param body - a decoded image answer or completed video result.
 * @returns the charge in millionths of a US dollar, or undefined where the answer reports none.
 */
export function costOf(body: unknown): number | undefined {
  const usage = typeof body === 'object' && body !== null ? (body as { usage?: unknown }).usage : undefined
  const cost = typeof usage === 'object' && usage !== null ? (usage as { cost_usd_micros?: unknown }).cost_usd_micros : undefined
  return typeof cost === 'number' && Number.isSafeInteger(cost) && cost >= 0 ? cost : undefined
}

/**
 * Where a completed gateway job's clip is: an HTTPS link to the upstream's
 * storage, or the clip itself as `b64_json` when the upstream's download needs
 * the gateway's own key.
 * @param payload - the decoded job body, including its `result`.
 * @returns the finished clip's HTTPS URL, or its bytes and media type.
 */
export function videoSource(payload: unknown): { url: string } | GeneratedMedia {
  const result = typeof payload === 'object' && payload !== null ? (payload as { result?: unknown }).result : undefined
  const rows = typeof result === 'object' && result !== null ? (result as { data?: unknown }).data : undefined
  const first: unknown = Array.isArray(rows) ? rows[0] : undefined
  const row = typeof first === 'object' && first !== null ? first as { url?: unknown; b64_json?: unknown; media_type?: unknown } : {}
  if (typeof row.b64_json === 'string' && row.b64_json.length > 0) {
    return {
      mediaType: row.media_type === 'video/webm' ? 'video/webm' : 'video/mp4',
      data: Uint8Array.from(Buffer.from(row.b64_json, 'base64')),
    }
  }
  if (typeof row.url !== 'string' || !row.url.startsWith('https://')) {
    throw new MediaError('Aeven video result carried neither an HTTPS video URL nor the video', 'MEDIA_UPSTREAM')
  }
  return { url: row.url }
}

/**
 * The seam failure for one refused gateway response.
 * @param status - the HTTP status.
 * @param text - the response body.
 * @param kind - what was requested, named in the message.
 * @returns the error naming the gateway's own message.
 */
export function gatewayError(status: number, text: string, kind: 'image' | 'video' = 'image'): MediaError {
  let message = text
  try {
    const parsed = JSON.parse(text) as { error?: { message?: unknown } }
    if (typeof parsed.error?.message === 'string') message = parsed.error.message
  } catch {
    // A body that is not JSON (a proxy's HTML page) is reported as it came.
  }
  const code: MediaErrorCode = status === 401
    ? 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE'
    : status === 400 || status === 404 || status === 413 || status === 422
      ? 'MEDIA_INVALID_REQUEST'
      : 'MEDIA_UPSTREAM'
  return new MediaError(
    `Aeven ${kind} request failed with HTTP ${String(status)}${message === '' ? '' : `: ${message}`}`,
    code,
  )
}

/**
 * Decode the gateway's `b64_json` answer.
 * @param payload - the decoded response body.
 * @returns the generated images.
 */
export function decodeImages(payload: unknown): GeneratedImage[] {
  const rows = typeof payload === 'object' && payload !== null ? (payload as { data?: unknown }).data : undefined
  if (!Array.isArray(rows)) {
    throw new MediaError('Aeven image response carried no data array', 'MEDIA_UPSTREAM')
  }
  const images: GeneratedImage[] = []
  for (const row of rows) {
    const encoded = typeof row === 'object' && row !== null ? (row as { b64_json?: unknown }).b64_json : undefined
    if (typeof encoded !== 'string') continue
    const data = Uint8Array.from(Buffer.from(encoded, 'base64'))
    images.push({ kind: 'bytes', mediaType: imageMediaType(data), data })
  }
  if (images.length === 0) {
    throw new MediaError('Aeven image response carried no image data', 'MEDIA_UPSTREAM')
  }
  return images
}

/**
 * Register the Aeven image and video providers on `ctx.media`.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - registry key, Aeven origin, credential reference, and download ceiling.
 */
export function apply(ctx: Context, config: Config): void {
  const { id, endpoint, videoEndpoint, apiKeyEnv, maxVideoBytes } = resolveConfig(config)

  /**
   * The bearer for one generation: the signed-in session of the account whose
   * Session is generating, else of the acting caller. Several clients signed
   * in to different accounts share one Host, so a generation never presents
   * another user's session.
   */
  const token = async (): Promise<string> => {
    const ref = credentialRef(apiKeyEnv)
    const credentials = ctx.get('credentials')
    if (credentials !== undefined) {
      const user = ctx.get('agents')?.currentInitiator()?.session.header.owner
        ?? ctx.get('identityUsers')?.actingUser()?.id
      const hit = await credentials.resolve(ref, user)
      if (hit !== undefined && hit.value.length > 0) return hit.value
    }
    const ambient = process.env[ref]
    if (ambient !== undefined && ambient.length > 0) return ambient
    throw new MediaError(
      `media-aeven: no Aeven session for media provider "${id}"; sign in, or store ${ref}`
      + ' through the credentials service when running headless',
      'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
    )
  }

  const images: MediaImageProvider = {
    id,
    // Always offered: a missing sign-in is reported by the call itself, naming
    // the remedy, rather than hiding the models from every menu.
    available: () => true,
    listImageModels: (): Promise<readonly MediaImageModel[]> => Promise.resolve(
      AEVEN_IMAGE_MODELS.map(model => ({
        provider: id,
        id: model.id,
        label: model.label,
        description: model.description,
      })),
    ),
    async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult> {
      const body = requestBody(request)
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${await token()}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(body),
        redirect: 'error',
        ...signal === undefined ? {} : { signal },
      })
      const text = await response.text()
      if (!response.ok) throw gatewayError(response.status, text)
      let payload: unknown
      try {
        payload = JSON.parse(text)
      } catch (error) {
        throw new MediaError('Aeven image response was not JSON', 'MEDIA_UPSTREAM', { cause: error })
      }
      const cost = costOf(payload)
      return {
        provider: id,
        model: request.model,
        images: decodeImages(payload),
        ...cost === undefined ? {} : { costUsdMicros: cost },
      }
    },
  }

  ctx.effect(() => ctx.media.registerImageProvider(images), 'media-aeven: image provider')

  /**
   * Send one authenticated gateway request and decode its JSON answer.
   * @param url - the gateway route.
   * @param init - method, extra headers, and body.
   * @param signal - cancellation forwarded from the caller.
   * @returns the decoded body.
   */
  const gatewayJson = async (
    url: string,
    init: { method: 'GET' | 'POST'; headers?: Record<string, string>; body?: string },
    signal: AbortSignal | undefined,
  ): Promise<unknown> => {
    const response = await fetch(url, {
      method: init.method,
      headers: {
        'Authorization': `Bearer ${await token()}`,
        'Accept': 'application/json',
        ...init.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...init.headers,
      },
      ...init.body === undefined ? {} : { body: init.body },
      redirect: 'error',
      ...signal === undefined ? {} : { signal },
    })
    const text = await response.text()
    if (!response.ok) throw gatewayError(response.status, text, 'video')
    try {
      return JSON.parse(text) as unknown
    } catch (error) {
      throw new MediaError('Aeven video response was not JSON', 'MEDIA_UPSTREAM', { cause: error })
    }
  }

  const jobUrl = (jobId: string): string => `${videoEndpoint}/${encodeURIComponent(jobId)}`

  const videos: MediaVideoProvider = {
    id,
    available: () => true,
    async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob> {
      // The gateway holds the generation as its own job, so a dropped
      // connection never loses or re-bills a paid render.
      const payload = await gatewayJson(videoEndpoint, {
        method: 'POST',
        headers: { Prefer: 'respond-async' },
        body: JSON.stringify(videoRequestBody(request)),
      }, signal)
      return videoJob(id, payload)
    },
    async videoStatus(jobId: string, signal?: AbortSignal): Promise<MediaVideoJob> {
      return videoJob(id, await gatewayJson(jobUrl(jobId), { method: 'GET' }, signal))
    },
    async fetchVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia> {
      const payload = await gatewayJson(jobUrl(jobId), { method: 'GET' }, signal)
      const job = videoJob(id, payload)
      if (job.status !== 'succeeded') {
        throw new MediaError(`Aeven video job ${jobId} is ${job.status}, not finished`, 'MEDIA_UPSTREAM')
      }
      const source = videoSource(payload)
      if (!('url' in source)) {
        if (source.data.byteLength > maxVideoBytes) {
          throw new MediaError(`video exceeds the ${String(maxVideoBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
        }
        return source
      }
      // The URL is the one the gateway itself recorded for this caller's job;
      // it names the upstream's expiring storage, which carries no credential.
      const response = await fetch(source.url, {
        headers: { Accept: 'video/mp4,video/webm' },
        ...signal === undefined ? {} : { signal },
      })
      if (!response.ok) {
        throw new MediaError(`Aeven video download failed with HTTP ${String(response.status)}`, 'MEDIA_UPSTREAM')
      }
      const declared = Number(response.headers.get('content-length') ?? Number.NaN)
      if (Number.isFinite(declared) && declared > maxVideoBytes) {
        throw new MediaError(`video exceeds the ${String(maxVideoBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > maxVideoBytes) {
        throw new MediaError(`video exceeds the ${String(maxVideoBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      const mediaType = (response.headers.get('content-type') ?? '').split(';', 1)[0]?.trim().toLowerCase()
      return { mediaType: mediaType === 'video/webm' ? 'video/webm' : 'video/mp4', data }
    },
  }

  ctx.effect(() => ctx.media.registerVideoProvider(videos), 'media-aeven: video provider')
}
