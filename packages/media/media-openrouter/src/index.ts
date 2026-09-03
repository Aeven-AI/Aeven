/**
 * OpenRouter video provider for `ctx.media`. Video is a job everywhere, and
 * OpenRouter is the one surveyed provider that enumerates its own job states,
 * so its vocabulary is what the seam's union follows and this adapter maps
 * onto directly.
 * @module @deepseek-ai/dsh-media-openrouter
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-credentials'
import { MediaError } from '@deepseek-ai/dsh-media'
import type {
  GeneratedMedia,
  MediaVideoJob,
  MediaVideoProvider,
  MediaVideoRequest,
  MediaVideoStatus,
} from '@deepseek-ai/dsh-media'

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

/** One job body as OpenRouter returns it; unknown fields are ignored. */
interface JobBody {
  id?: unknown
  status?: unknown
  error?: unknown
}

/**
 * Translate one job body into the seam's job.
 *
 * An unrecognized status keeps the job `running` rather than inventing a
 * terminal state: OpenRouter may add one, and a caller that keeps polling
 * recovers, while a caller told `failed` cannot.
 * @param providerId - the seam registry key that owns this job.
 * @param body - the decoded job body.
 * @returns the seam's job record.
 */
function toJob(providerId: string, body: JobBody): MediaVideoJob {
  const id = typeof body.id === 'string' ? body.id : undefined
  if (id === undefined) {
    throw new MediaError('OpenRouter video job carried no id', 'MEDIA_UPSTREAM')
  }
  const raw = typeof body.status === 'string' ? body.status : ''
  const status = STATUS[raw] ?? 'running'
  const error = typeof body.error === 'string' && body.error.length > 0 ? body.error : undefined
  return {
    provider: providerId,
    id,
    status,
    ...status === 'failed' ? { error: error ?? `OpenRouter reported video status "${raw}"` } : {},
  }
}

/**
 * Register the OpenRouter video provider on `ctx.media`.
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

  /** One JSON call against the pinned origin. */
  const call = async (path: string, init: RequestInit, signal?: AbortSignal): Promise<JobBody> => {
    const apiKey = await resolveApiKey()
    const response = await fetch(new URL(path, OPENROUTER_ORIGIN), {
      ...init,
      headers: jsonHeaders(init.headers, apiKey),
      redirect: 'error',
      ...signal === undefined ? {} : { signal },
    })
    const text = await response.text()
    if (!response.ok) {
      throw new MediaError(
        `OpenRouter video request failed with HTTP ${String(response.status)}${text === '' ? '' : `: ${text}`}`,
        'MEDIA_UPSTREAM',
      )
    }
    try {
      return JSON.parse(text) as JobBody
    } catch (cause) {
      throw new MediaError('OpenRouter returned a non-JSON video job body', 'MEDIA_UPSTREAM', { cause })
    }
  }

  const provider: MediaVideoProvider = {
    id,
    available: () => process.env[apiKeyEnv] !== undefined || ctx.get('credentials') !== undefined,

    async startVideo(request: MediaVideoRequest, signal?: AbortSignal): Promise<MediaVideoJob> {
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
      return toJob(id, await call('/api/v1/videos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }, signal))
    },

    async videoStatus(jobId: string, signal?: AbortSignal): Promise<MediaVideoJob> {
      return toJob(id, await call(`/api/v1/videos/${encodeURIComponent(jobId)}`, { method: 'GET' }, signal))
    },

    async fetchVideo(jobId: string, signal?: AbortSignal): Promise<GeneratedMedia> {
      const apiKey = await resolveApiKey()
      // The content route proxies the bytes, so egress stays on this origin
      // rather than following whichever upstream CDN served the model.
      const response = await fetch(
        new URL(`/api/v1/videos/${encodeURIComponent(jobId)}/content`, OPENROUTER_ORIGIN),
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          redirect: 'error',
          ...signal === undefined ? {} : { signal },
        },
      )
      if (!response.ok) {
        throw new MediaError(
          `OpenRouter video content failed with HTTP ${String(response.status)}`,
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

  ctx.effect(() => ctx.media.registerVideoProvider(provider), 'media-openrouter: video provider')
}
