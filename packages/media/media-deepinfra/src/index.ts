/**
 * DeepInfra image and video provider for `ctx.media`. Images use DeepInfra's
 * native route for Seedream and the OpenAI-compatible route for other images.
 * Video has its own status vocabulary, mapped onto the seam's union. Image models are read from the
 * vendor's own catalog (`/models/list`), not from the OpenAI-shaped listing,
 * which omits models that serve here.
 * @module @aeven/media-deepinfra
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { imageMediaType, MediaError, vendorRoute, vendorVideoProvider } from '@aeven/media'
import type {
  GeneratedImage,
  MediaImageModel,
  MediaImageProvider,
  MediaImageRequest,
  MediaImageResult,
  MediaVideoStatus,
} from '@aeven/media'

/** Cordis plugin name. */
export const name = 'media-deepinfra'
/** The media seam must exist before this provider can register into it. */
export const inject = ['media']

/** DeepInfra's API root; bearer-authenticated requests stay on this origin. */
export const DEEPINFRA_ORIGIN = 'https://api.deepinfra.com'

const SEEDREAM_MODELS = new Set(['ByteDance/Seedream-4', 'ByteDance/Seedream-4.5', 'ByteDance/Seedream-5.0-Pro'])
const ARK_IMAGE_HOSTS = new Set([
  'ark-content-generation-v2-ap-southeast-1.tos-ap-southeast-1.volces.com',
  'ark-acg-ap-southeast-1.tos-ap-southeast-1.volces.com',
])

/**
 * DeepInfra's observed job states, mapped onto the seam's union.
 *
 * `queued` maps to `running`, not to a not-yet-started state: DeepInfra reports
 * `queued` for a job that is actively rendering and publishes no running value
 * at all — three observed jobs, including a 10-second clip taking 27.6s, went
 * `queued` → `succeeded` directly under 200ms polling. Its OpenAPI spec types
 * `status` as a bare string with no enum, so this table is what was observed
 * rather than what was promised, and an unrecognized value keeps polling.
 */
const STATUS: Readonly<Record<string, MediaVideoStatus>> = {
  queued: 'running',
  running: 'running',
  processing: 'running',
  in_progress: 'running',
  succeeded: 'succeeded',
  completed: 'succeeded',
  failed: 'failed',
  error: 'failed',
  cancelled: 'failed',
}

/** Config for the DeepInfra media provider. */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `deepinfra`. */
  id?: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Ceiling on one retrieved clip, in bytes. */
  maxVideoBytes?: number
  /** Ceiling on one downloaded native image, in bytes. */
  maxImageBytes?: number
}

export const Config: z<Config> = z.object({
  id: z.string().default('deepinfra'),
  apiKeyEnv: z.string().default('DEEPINFRA_API_KEY'),
  maxVideoBytes: z.number().default(256 * 1024 * 1024),
  maxImageBytes: z.number().min(1).default(32 * 1024 * 1024),
})

/** Config after schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** Vendor name as it reads in this provider's failure text. */
const VENDOR = 'DeepInfra'

/** Download an Ark image without credentials or redirects, enforcing the byte ceiling while reading. */
async function downloadNativeImage(location: string, maxBytes: number, signal?: AbortSignal): Promise<GeneratedImage> {
  let url: URL
  try {
    url = new URL(location)
  } catch {
    // Malformed upstream URLs cannot identify a permitted image origin.
    throw new MediaError('DeepInfra returned an invalid image URL', 'MEDIA_UPSTREAM')
  }
  if (url.protocol !== 'https:' || !ARK_IMAGE_HOSTS.has(url.hostname) || url.port !== '' || url.username !== '' || url.password !== '') {
    throw new MediaError('DeepInfra returned an image outside the permitted Ark CDN origin', 'MEDIA_UPSTREAM')
  }
  const response = await fetch(url, { redirect: 'error', ...signal === undefined ? {} : { signal } })
  if (!response.ok || response.body === null) {
    throw new MediaError(`Ark image download failed with HTTP ${String(response.status)}`, 'MEDIA_UPSTREAM')
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytes += chunk.value.byteLength
      if (bytes > maxBytes) {
        await reader.cancel()
        throw new MediaError(`generated image exceeds the ${String(maxBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      chunks.push(chunk.value)
    }
  } finally {
    reader.releaseLock()
  }
  const data = Buffer.concat(chunks, bytes)
  return { kind: 'bytes', mediaType: imageMediaType(data), data }
}

/**
 * Register the DeepInfra image and video provider on `ctx.media`.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - registry key, credential reference, and image/video byte ceilings.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { id, apiKeyEnv, maxVideoBytes, maxImageBytes } = config as ResolvedConfig

  const route = vendorRoute(ctx, { id, apiKeyEnv, origin: DEEPINFRA_ORIGIN, vendor: VENDOR })
  const call = route.json

  const images: MediaImageProvider = {
    id,
    available: route.available,
    async listImageModels(signal?: AbortSignal): Promise<readonly MediaImageModel[]> {
      // The catalog document lists every modality; `type` is what marks the
      // image generators. The OpenAI-shaped listing is not a substitute: it
      // tags image models `image-gen` and omits models that serve here anyway
      // (ByteDance/Seedream-5.0-Pro and -4.5 are absent from it).
      const payload = await call('/models/list', { method: 'GET' }, signal)
      const rows = Array.isArray(payload['data']) ? payload['data'] : payload
      if (!Array.isArray(rows)) return []
      const models: MediaImageModel[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const entry = row as { model_name?: unknown; type?: unknown; deprecated?: unknown; description?: unknown }
        if (typeof entry.model_name !== 'string' || entry.model_name === '') continue
        if (entry.type !== 'text-to-image') continue
        if (entry.deprecated === true) continue
        const description = entry.description
        models.push({
          provider: id,
          id: entry.model_name,
          ...typeof description === 'string' && description !== '' ? { description } : {},
        })
      }
      return models
    },

    async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult> {
      if (SEEDREAM_MODELS.has(request.model)) {
        const pro = request.model === 'ByteDance/Seedream-5.0-Pro'
        const references = request.references ?? []
        const unsupported = pro
          ? [['seed', request.seed], ['guidanceScale', request.guidanceScale]]
          : [['outputFormat', request.outputFormat], ['background', request.background], ['optimizePromptMode', request.optimizePromptMode]]
        unsupported.push(['aspectRatio', request.aspectRatio], ['quality', request.quality])
        for (const [field, value] of unsupported) {
          if (value !== undefined) throw new MediaError(`${String(field)} is not supported by ${request.model}`, 'MEDIA_INVALID_REQUEST')
        }
        if (request.size !== undefined && request.resolution !== undefined) {
          throw new MediaError('Pass either size or resolution, not both', 'MEDIA_INVALID_REQUEST')
        }
        if (references.length > (pro ? 4 : 1)) {
          throw new MediaError(`${request.model} accepts at most ${pro ? '4' : '1'} reference images`, 'MEDIA_INVALID_REQUEST')
        }
        if (request.n !== undefined && (!Number.isInteger(request.n) || request.n < 1)) {
          throw new MediaError('n must be a positive integer', 'MEDIA_INVALID_REQUEST')
        }
        const body: Record<string, unknown> = { prompt: request.prompt }
        const size = request.size ?? request.resolution
        if (size !== undefined) body['size'] = size
        if (request.seed !== undefined) body['seed'] = request.seed
        if (request.guidanceScale !== undefined) body['guidance_scale'] = request.guidanceScale
        if (request.outputFormat !== undefined) body['output_format'] = request.outputFormat
        if (request.background !== undefined) body['background'] = request.background
        if (request.optimizePromptMode !== undefined) body['optimize_prompt_mode'] = request.optimizePromptMode
        references.forEach((reference, index) => {
          body[index === 0 ? 'image' : `image_${String(index + 1)}`] = `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`
        })
        const generated: GeneratedImage[] = []
        for (let index = 0; index < (request.n ?? 1); index++) {
          const payload = await call(`/v1/inference/${request.model}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
          }, signal)
          const locations = payload['images']
          if (!Array.isArray(locations) || locations.length === 0 || locations.some(location => typeof location !== 'string')) {
            throw new MediaError('DeepInfra native response carried no image URLs', 'MEDIA_UPSTREAM')
          }
          for (const location of locations as string[]) generated.push(await downloadNativeImage(location, maxImageBytes, signal))
        }
        return { provider: id, model: request.model, images: generated }
      }
      for (const [field, value] of [
        ['seed', request.seed], ['guidanceScale', request.guidanceScale], ['outputFormat', request.outputFormat],
        ['optimizePromptMode', request.optimizePromptMode],
      ]) {
        if (value !== undefined) throw new MediaError(`${String(field)} requires a supported Seedream native model`, 'MEDIA_INVALID_REQUEST')
      }
      if (request.resolution !== undefined) {
        throw new MediaError(
          `DeepInfra's image route takes an explicit size, not the resolution tier "${request.resolution}"; pass pixel size as \`size\``,
          'MEDIA_INVALID_REQUEST',
        )
      }
      const references = request.references ?? []
      if (references.length > 1) {
        throw new MediaError(
          'DeepInfra\'s OpenAI-compatible image route takes one reference image; multi-reference generation needs the native /v1/inference route',
          'MEDIA_INVALID_REQUEST',
        )
      }
      const body: Record<string, unknown> = {
        model: request.model,
        prompt: request.prompt,
        // The route documents base64 as its only supported response format.
        response_format: 'b64_json',
      }
      if (request.n !== undefined) body['n'] = request.n
      if (request.size !== undefined) body['size'] = request.size
      if (request.background !== undefined) body['background'] = request.background
      const first = references[0]
      if (first !== undefined) {
        body['image'] = `data:${first.mediaType};base64,${Buffer.from(first.data).toString('base64')}`
      }
      const payload = await call('/v1/openai/images/generations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      const rows = Array.isArray(payload['data']) ? payload['data'] : undefined
      if (rows === undefined) {
        throw new MediaError('DeepInfra image response carried no data array', 'MEDIA_UPSTREAM')
      }
      const generated: GeneratedImage[] = []
      for (const row of rows) {
        const encoded = typeof row === 'object' && row !== null ? (row as { b64_json?: unknown }).b64_json : undefined
        if (typeof encoded !== 'string') continue
        const data = Uint8Array.from(Buffer.from(encoded, 'base64'))
        generated.push({ kind: 'bytes', mediaType: imageMediaType(data), data })
      }
      if (generated.length === 0) {
        throw new MediaError('DeepInfra image response carried no image data', 'MEDIA_UPSTREAM')
      }
      return { provider: id, model: request.model, images: generated }
    },
  }

  // The job body's own `data[].url` names whichever upstream vendor served the
  // model, so every retrieval goes through DeepInfra's own content route.
  const video = vendorVideoProvider({
    id,
    vendor: VENDOR,
    route,
    routes: {
      start: '/v1/videos',
      status: jobId => `/v1/videos/${encodeURIComponent(jobId)}`,
      content: jobId => `/v1/videos/${encodeURIComponent(jobId)}/content`,
    },
    maxBytes: maxVideoBytes,
    statuses: STATUS,
    requestBody: (request) => {
      const body: Record<string, unknown> = { model: request.model, prompt: request.prompt }
      if (request.duration !== undefined) body['seconds'] = request.duration
      if (request.aspectRatio !== undefined) body['aspect_ratio'] = request.aspectRatio
      if (request.size !== undefined) body['size'] = request.size
      if (request.seed !== undefined) body['seed'] = request.seed
      const first = request.references?.[0]
      if (first !== undefined) {
        // The route takes one first-frame image for image-to-video, as a data URI.
        body['image_url'] = `data:${first.mediaType};base64,${Buffer.from(first.data).toString('base64')}`
      }
      return body
    },
  })

  ctx.effect(() => ctx.media.registerImageProvider(images), 'media-deepinfra: image provider')
  ctx.effect(() => ctx.media.registerVideoProvider(video), 'media-deepinfra: video provider')
}
