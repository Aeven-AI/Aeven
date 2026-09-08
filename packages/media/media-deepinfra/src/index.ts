/**
 * DeepInfra image and video provider for `ctx.media`. Images use DeepInfra's
 * OpenAI-compatible route and return base64; video is a job with its own status
 * vocabulary, mapped onto the seam's union.
 * @module @deepseek-ai/dsh-media-deepinfra
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import { imageMediaType, MediaError } from '@deepseek-ai/dsh-media'
import type {
  GeneratedImage,
  MediaImageModel,
  GeneratedMedia,
  MediaImageProvider,
  MediaImageRequest,
  MediaImageResult,
  MediaVideoJob,
  MediaVideoProvider,
  MediaVideoRequest,
  MediaVideoStatus,
} from '@deepseek-ai/dsh-media'

/** Cordis plugin name. */
export const name = 'media-deepinfra'
/** The media seam must exist before this provider can register into it. */
export const inject = ['media']

/** DeepInfra's API root. Only this origin is contacted. */
export const DEEPINFRA_ORIGIN = 'https://api.deepinfra.com'

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
}

export const Config: z<Config> = z.object({
  id: z.string().default('deepinfra'),
  apiKeyEnv: z.string().default('DEEPINFRA_API_KEY'),
  maxVideoBytes: z.number().default(256 * 1024 * 1024),
})

/** Config after schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/**
 * Request headers for one JSON call. `HeadersInit` may be an array or a
 * `Headers`, so it is normalized rather than spread.
 * @param base - the caller's own headers, if any.
 * @param apiKey - the resolved bearer token.
 * @returns the merged header record.
 */
function jsonHeaders(base: HeadersInit | undefined, apiKey: string): Record<string, string> {
  const headers = new Headers(base)
  headers.set('Authorization', `Bearer ${apiKey}`)
  headers.set('Accept', 'application/json')
  return Object.fromEntries(headers.entries())
}

/** One job body as DeepInfra returns it; unknown fields are ignored. */
interface JobBody {
  id?: unknown
  status?: unknown
  error?: unknown
}

/**
 * Translate one job body into the seam's job. An explicit `error` is the
 * trustworthy failure signal here, because the status vocabulary is
 * undocumented and could grow a value this table does not know.
 * @param providerId - the seam registry key that owns this job.
 * @param body - the decoded job body.
 * @returns the seam's job record.
 */
function toJob(providerId: string, body: JobBody): MediaVideoJob {
  const id = typeof body.id === 'string' ? body.id : undefined
  if (id === undefined) {
    throw new MediaError('DeepInfra video job carried no id', 'MEDIA_UPSTREAM')
  }
  const error = typeof body.error === 'string' && body.error.length > 0 ? body.error : undefined
  const raw = typeof body.status === 'string' ? body.status : ''
  const status: MediaVideoStatus = error !== undefined ? 'failed' : STATUS[raw] ?? 'running'
  return { provider: providerId, id, status, ...status === 'failed' ? { error: error ?? `status "${raw}"` } : {} }
}

/**
 * Register the DeepInfra image and video provider on `ctx.media`.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - registry key, credential reference, and the size ceiling.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { id, apiKeyEnv, maxVideoBytes } = config as ResolvedConfig

  const resolveApiKey = async (): Promise<string> => {
    const resolved = await ctx.get('credentials')?.resolve(credentialRef(apiKeyEnv))
    const apiKey = resolved?.value ?? process.env[apiKeyEnv]
    if (apiKey === undefined || apiKey === '') {
      throw new MediaError(
        `no credential resolved from ${apiKeyEnv} for media provider "${id}"`,
        'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
      )
    }
    return apiKey
  }

  const call = async (path: string, init: RequestInit, signal?: AbortSignal): Promise<Record<string, unknown>> => {
    const apiKey = await resolveApiKey()
    const response = await fetch(new URL(path, DEEPINFRA_ORIGIN), {
      ...init,
      headers: jsonHeaders(init.headers, apiKey),
      redirect: 'error',
      ...signal === undefined ? {} : { signal },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new MediaError(
        `DeepInfra request failed with HTTP ${String(response.status)}${text === '' ? '' : `: ${text}`}`,
        'MEDIA_UPSTREAM',
      )
    }
    try {
      return JSON.parse(text) as Record<string, unknown>
    } catch (cause) {
      throw new MediaError('DeepInfra returned a non-JSON body', 'MEDIA_UPSTREAM', { cause })
    }
  }

  const images: MediaImageProvider = {
    id,
    available: () => process.env[apiKeyEnv] !== undefined || ctx.get('credentials') !== undefined,
    async listImageModels(signal?: AbortSignal): Promise<readonly MediaImageModel[]> {
      // The same document lists chat, video, speech and embedding models; the
      // `text-to-image` tag is what marks the ones this route can generate.
      const payload = await call('/v1/openai/models', { method: 'GET' }, signal)
      const rows = Array.isArray(payload['data']) ? payload['data'] : []
      const models: MediaImageModel[] = []
      for (const row of rows) {
        if (typeof row !== 'object' || row === null) continue
        const entry = row as { id?: unknown; metadata?: { tags?: unknown; description?: unknown } | undefined }
        if (typeof entry.id !== 'string' || entry.id === '') continue
        const tags = Array.isArray(entry.metadata?.tags) ? entry.metadata.tags : []
        if (!tags.some(tag => tag === 'text-to-image' || tag === 'image')) continue
        const description = entry.metadata?.description
        models.push({
          provider: id,
          id: entry.id,
          ...typeof description === 'string' && description !== '' ? { description } : {},
        })
      }
      return models
    },

    async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult> {
      const body: Record<string, unknown> = {
        model: request.model,
        prompt: request.prompt,
        // The route documents base64 as its only supported response format.
        response_format: 'b64_json',
      }
      if (request.n !== undefined) body['n'] = request.n
      if (request.size !== undefined) body['size'] = request.size
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

  const video: MediaVideoProvider = {
    id,
    available: () => process.env[apiKeyEnv] !== undefined || ctx.get('credentials') !== undefined,

    async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob> {
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
      return toJob(id, await call('/v1/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, signal))
    },

    async videoStatus(jobId: string, signal?: AbortSignal): Promise<MediaVideoJob> {
      return toJob(id, await call(`/v1/videos/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal))
    },

    async fetchVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia> {
      const apiKey = await resolveApiKey()
      // The content route proxies the bytes. The job body's own `data[].url`
      // names whichever upstream vendor served the model, so retrieving through
      // DeepInfra keeps egress on one pinnable origin.
      const response = await fetch(
        new URL(`/v1/videos/${encodeURIComponent(jobId)}/content`, DEEPINFRA_ORIGIN),
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error',
          ...signal === undefined ? {} : { signal },
        },
      )
      if (!response.ok) {
        throw new MediaError(
          `DeepInfra video content failed with HTTP ${String(response.status)}`,
          'MEDIA_UPSTREAM',
        )
      }
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > maxVideoBytes) {
        throw new MediaError(`video exceeds the ${String(maxVideoBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      const data = new Uint8Array(await response.arrayBuffer())
      if (data.byteLength > maxVideoBytes) {
        throw new MediaError(`video exceeds the ${String(maxVideoBytes)} byte ceiling`, 'MEDIA_UPSTREAM')
      }
      const mediaType = response.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? 'video/mp4'
      return { mediaType, data }
    },
  }

  ctx.effect(() => ctx.media.registerImageProvider(images), 'media-deepinfra: image provider')
  ctx.effect(() => ctx.media.registerVideoProvider(video), 'media-deepinfra: video provider')
}
