/**
 * Aeven gateway image provider for `ctx.media`. It serves Aeven's two image
 * models, `Aeven-1.0-Image-Flash` and `Aeven-1.0-Image-Pro`, through the
 * gateway's `POST /v1/images/generations` with the signed-in user's Aeven
 * session as the bearer, so generating an image needs a sign-in and no vendor
 * key.
 *
 * The catalog is shipped rather than fetched. The gateway's `GET /v1/models`
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
  /** Most images one request may ask for. */
  readonly maxImages: number
  /** Most reference images one request may supply. */
  readonly maxReferenceImages: number
  /** Backgrounds the model can generate; empty when it has no background option. */
  readonly backgrounds: readonly MediaImageBackground[]
}

/** The model a deployment generates with when nothing else is chosen. */
export const DEFAULT_IMAGE_MODEL = 'Aeven-1.0-Image-Flash'

/** Aeven's image models, default first. */
export const AEVEN_IMAGE_MODELS: readonly AevenImageModel[] = [
  {
    id: 'Aeven-1.0-Image-Flash',
    label: 'Aeven Image Flash',
    description: 'Seedream 4 generation and editing. Size 1K, 2K (default), 4K or WIDTHxHEIGHT; one reference image; seed and guidance scale 1–10.',
    maxImages: 4,
    maxReferenceImages: 1,
    backgrounds: [],
  },
  {
    id: 'Aeven-1.0-Image-Pro',
    label: 'Aeven Image Pro',
    description: 'Seedream 5.0 Pro. Size 1K, 1.5K, 2K (default) or WIDTHxHEIGHT; four references; PNG/JPEG, background and standard/fast prompt optimization.',
    maxImages: 4,
    maxReferenceImages: 4,
    backgrounds: ['transparent', 'opaque'],
  },
]

/** Config for the Aeven image provider. */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `aeven`. */
  id?: string
  /** Aeven API origin; `/v1` is appended. Defaults to the development gateway. */
  apiUrl?: string
  /** Credential reference holding the signed-in session; defaults to `AEVEN_TOKEN`. */
  apiKeyEnv?: string
}

export const Config: z<Config> = z.object({
  id: z.string().default(DEFAULT_PROVIDER_ID),
  apiUrl: z.string().default(DEFAULT_API_URL),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV),
})

/** One provider's fully resolved connection facts. */
export interface ResolvedConfig {
  /** Registry key under `ctx.media`. */
  readonly id: string
  /** The image generation endpoint. */
  readonly endpoint: string
  /** Credential reference holding the signed-in session. */
  readonly apiKeyEnv: string
}

/**
 * Resolve one entry's config to the facts every request uses.
 * @param config - the entry's config.
 * @returns the registry key, endpoint, and credential reference.
 */
export function resolveConfig(config: Config): ResolvedConfig {
  return {
    id: config.id ?? DEFAULT_PROVIDER_ID,
    endpoint: `${(config.apiUrl ?? DEFAULT_API_URL).replace(/\/+$/, '')}/v1/images/generations`,
    apiKeyEnv: config.apiKeyEnv ?? DEFAULT_API_KEY_ENV,
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
    ...request.guidanceScale === undefined ? {} : { guidance_scale: request.guidanceScale },
    ...request.outputFormat === undefined ? {} : { output_format: request.outputFormat },
    ...request.optimizePromptMode === undefined ? {} : { optimize_prompt_mode: request.optimizePromptMode },
    ...request.background === undefined ? {} : { background: request.background },
    ...references.length === 0 ? {} : {
      image: references.map(reference => `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`),
    },
  }
}

/**
 * The seam failure for one refused gateway response.
 * @param status - the HTTP status.
 * @param text - the response body.
 * @returns the error naming the gateway's own message.
 */
export function gatewayError(status: number, text: string): MediaError {
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
    `Aeven image request failed with HTTP ${String(status)}${message === '' ? '' : `: ${message}`}`,
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
 * Register the Aeven image provider on `ctx.media`.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - registry key, Aeven origin, and credential reference.
 */
export function apply(ctx: Context, config: Config): void {
  const { id, endpoint, apiKeyEnv } = resolveConfig(config)

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
      return { provider: id, model: request.model, images: decodeImages(payload) }
    },
  }

  ctx.effect(() => ctx.media.registerImageProvider(images), 'media-aeven: image provider')
}
