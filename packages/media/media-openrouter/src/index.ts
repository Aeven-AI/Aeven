/**
 * OpenRouter image and video provider for `ctx.media`. Images use the dedicated
 * `/api/v1/images` route, which is where OpenRouter adds new image models and
 * which accepts every control the seam's image request carries. Video is a job
 * everywhere, and OpenRouter is the one surveyed provider that enumerates its
 * own job states, so its vocabulary is what the seam's union follows and this
 * adapter maps onto directly.
 * @module @aeven/media-openrouter
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { imageMediaType, MediaError, rejectImageControls, vendorRoute, vendorVideoProvider } from '@aeven/media'
import type {
  GeneratedImage,
  MediaImageModel,
  MediaImageProvider,
  MediaImageRequest,
  MediaImageResult,
  MediaVideoStatus,
} from '@aeven/media'

/** Cordis plugin name. */
export const name = 'media-openrouter'
/** The media seam must exist before this provider can register into it. */
export const inject = ['media']

/** OpenRouter's API root. Only this origin is contacted. */
export const OPENROUTER_ORIGIN = 'https://openrouter.ai'

/**
 * Job states OpenRouter documents, mapped onto the seam's union. `pending` and
 * `in_progress` are both "poll again"; `cancelled` and `expired` are terminal
 * failures rather than a fourth seam state, because a caller's next move for
 * each is the same as for `failed`.
 */
const STATUS: Readonly<Record<string, MediaVideoStatus>> = {
  pending: 'running',
  in_progress: 'running',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'failed',
  expired: 'failed',
}

/** Config for the OpenRouter media provider. */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `openrouter`. */
  id?: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv?: string
  /** Ceiling on one retrieved clip, in bytes. */
  maxVideoBytes?: number
}

export const Config: z<Config> = z.object({
  id: z.string().default('openrouter'),
  apiKeyEnv: z.string().default('OPENROUTER_API_KEY'),
  maxVideoBytes: z.number().default(256 * 1024 * 1024),
})

/** Config after schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/** Vendor name as it reads in this provider's failure text. */
const VENDOR = 'OpenRouter'

/**
 * Register the OpenRouter video provider on `ctx.media`.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - registry key, credential reference, and the size ceiling.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { id, apiKeyEnv, maxVideoBytes } = config as ResolvedConfig

  const route = vendorRoute(ctx, { id, apiKeyEnv, origin: OPENROUTER_ORIGIN, vendor: VENDOR })
  const call = route.json

  const images: MediaImageProvider = {
    id,
    available: route.available,

    async listImageModels(signal?: AbortSignal): Promise<readonly MediaImageModel[]> {
      // `output_modalities` is what separates an image model from the chat
      // models in the same document; the chat route refuses these and the
      // image route serves only these.
      const payload = await call('/api/v1/models', { method: 'GET' }, signal)
      const rows = Array.isArray(payload['data']) ? payload['data'] : []
      const models: MediaImageModel[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const entry = row as {
          id?: unknown
          name?: unknown
          description?: unknown
          architecture?: { output_modalities?: unknown } | undefined
        }
        if (typeof entry.id !== 'string' || entry.id === '') continue
        const outputs = entry.architecture?.output_modalities
        if (!Array.isArray(outputs) || !outputs.includes('image')) continue
        models.push({
          provider: id,
          id: entry.id,
          ...typeof entry.name === 'string' && entry.name !== '' ? { label: entry.name } : {},
        })
      }
      return models
    },

    async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult> {
      rejectImageControls(request, ['guidanceScale', 'outputFormat', 'optimizePromptMode'])
      const body: Record<string, unknown> = { model: request.model, prompt: request.prompt }
      if (request.n !== undefined) body['n'] = request.n
      if (request.aspectRatio !== undefined) body['aspect_ratio'] = request.aspectRatio
      if (request.resolution !== undefined) body['resolution'] = request.resolution
      if (request.size !== undefined) body['size'] = request.size
      if (request.seed !== undefined) body['seed'] = request.seed
      if (request.references !== undefined && request.references.length > 0) {
        body['input_references'] = request.references.map(reference => ({
          type: 'image_url',
          image_url: {
            url: `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`,
          },
        }))
      }
      // The dedicated image route, not chat completions: OpenRouter adds new
      // image models exclusively here, and the chat route refuses these models
      // at its tool-compatibility step.
      const payload = await call('/api/v1/images', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, signal)
      const rows = Array.isArray(payload['data']) ? payload['data'] : undefined
      if (rows === undefined) {
        throw new MediaError('OpenRouter image response carried no data array', 'MEDIA_UPSTREAM')
      }
      const generated: GeneratedImage[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const { b64_json: encoded, media_type: declared } = row as { b64_json?: unknown; media_type?: unknown }
        if (typeof encoded !== 'string') continue
        const data = Uint8Array.from(Buffer.from(encoded, 'base64'))
        // `media_type` is present only when the route could identify the
        // format, so the signature is what labels the rest.
        const mediaType = typeof declared === 'string' && declared.length > 0 ? declared : imageMediaType(data)
        generated.push({ kind: 'bytes', mediaType, data })
      }
      if (generated.length === 0) {
        throw new MediaError('OpenRouter image response carried no image data', 'MEDIA_UPSTREAM')
      }
      return { provider: id, model: request.model, images: generated }
    },
  }

  // Retrieval goes through OpenRouter's own content route, so egress stays on
  // this origin rather than following whichever upstream CDN served the model.
  const provider = vendorVideoProvider({
    id,
    vendor: VENDOR,
    route,
    routes: {
      start: '/api/v1/videos',
      status: jobId => `/api/v1/videos/${encodeURIComponent(jobId)}`,
      content: jobId => `/api/v1/videos/${encodeURIComponent(jobId)}/content`,
    },
    maxBytes: maxVideoBytes,
    statuses: STATUS,
    requestBody: (request) => {
      const body: Record<string, unknown> = { model: request.model, prompt: request.prompt }
      if (request.duration !== undefined) body['duration'] = request.duration
      if (request.aspectRatio !== undefined) body['aspect_ratio'] = request.aspectRatio
      if (request.resolution !== undefined) body['resolution'] = request.resolution
      if (request.size !== undefined) body['size'] = request.size
      if (request.seed !== undefined) body['seed'] = request.seed
      if (request.generateAudio !== undefined) body['generate_audio'] = request.generateAudio
      if (request.references !== undefined && request.references.length > 0) {
        body['input_references'] = request.references.map(reference => ({
          type: 'image',
          image_url: `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`,
        }))
      }
      return body
    },
  })

  /**
   * The video models OpenRouter's own video catalog lists; the general model
   * document carries no video output modality.
   * @param signal - cancellation forwarded from the caller.
   * @returns the video models, labelled by their catalog names.
   */
  const listVideoModels = async (signal?: AbortSignal): Promise<readonly MediaImageModel[]> => {
    const payload = await call('/api/v1/videos/models', { method: 'GET' }, signal)
    const rows = Array.isArray(payload['data']) ? payload['data'] : []
    const models: MediaImageModel[] = []
    for (const row of rows) {
      if (typeof row !== 'object' || row === null) continue
      const entry = row as { id?: unknown; name?: unknown }
      if (typeof entry.id !== 'string' || entry.id === '') continue
      models.push({
        provider: id,
        id: entry.id,
        ...typeof entry.name === 'string' && entry.name !== '' ? { label: entry.name } : {},
      })
    }
    return models
  }

  ctx.effect(() => ctx.media.registerImageProvider(images), 'media-openrouter: image provider')
  ctx.effect(
    () => ctx.media.registerVideoProvider({ ...provider, listVideoModels }),
    'media-openrouter: video provider',
  )
}
