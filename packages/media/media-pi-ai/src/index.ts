/**
 * Image provider for `ctx.media` backed by pi-ai's unified model collection. pi-ai owns
 * the transports and the model metadata; this package owns credential
 * resolution, the request and result translation, and the failure mapping.
 * @module @aeven/media-pi-ai
 */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { credentialRef } from '@aeven/credentials'
import type {} from '@aeven/credentials'
import { MediaError, rejectImageControls } from '@aeven/media'
import type {} from '@aeven/media'
import type {
  GeneratedImage,
  MediaImageProvider,
  MediaImageRequest,
  MediaImageResult,
} from '@aeven/media'
import { createModels } from '@earendil-works/pi-ai'
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter'
import type { AssistantImages, ImagesInputContent } from '@earendil-works/pi-ai'

/** Cordis plugin name. */
export const name = 'media-pi-ai'
/** The media seam must exist before this provider can register into it. */
export const inject = ['media']

/**
 * Config for the pi-ai images provider. `id` is the registry key a request or
 * the seam's config names; it defaults to the upstream provider's own id so a
 * single-provider deployment needs no configuration at all.
 */
export interface Config {
  /** Registry key under `ctx.media`. Defaults to `openrouter`. */
  id?: string
  /** Credential reference resolved through `ctx.credentials`. */
  apiKeyEnv?: string
}

export const Config: z<Config> = z.object({
  id: z.string().default('openrouter'),
  apiKeyEnv: z.string().default('OPENROUTER_API_KEY'),
})

/** Config after schemastery has filled every defaulted field. */
type ResolvedConfig = Required<Config>

/**
 * Decode one pi-ai image output into seam bytes.
 * @param mimeType - the media type pi-ai reported.
 * @param base64 - the encoded payload.
 * @returns the decoded artifact.
 */
function decodeImage(mimeType: string, base64: string): GeneratedImage {
  return { kind: 'bytes', mediaType: mimeType, data: Uint8Array.from(Buffer.from(base64, 'base64')) }
}

/**
 * Translate one seam request into pi-ai's input content. Reference images ride
 * as inline base64 in the same order the caller supplied, which is what the
 * image-to-image models read as their references.
 * @param request - the seam request.
 * @returns pi-ai's ordered input content.
 */
function toInput(request: MediaImageRequest): ImagesInputContent[] {
  const input: ImagesInputContent[] = [{ type: 'text', text: request.prompt }]
  for (const reference of request.references ?? []) {
    input.push({
      type: 'image',
      mimeType: reference.mediaType,
      data: Buffer.from(reference.data).toString('base64'),
    })
  }
  return input
}

/**
 * Map a pi-ai result onto the seam's result, or throw the matching failure.
 * pi-ai reports failure in the result rather than by throwing, so an error
 * stop reason becomes a `MediaError` here instead of reaching a caller as an
 * empty success.
 * @param providerId - the seam registry key that served this call.
 * @param answer - pi-ai's result.
 * @returns the generated images.
 */
function toResult(providerId: string, answer: AssistantImages): MediaImageResult {
  if (answer.stopReason === 'error') {
    throw new MediaError(answer.errorMessage ?? 'image generation failed', 'MEDIA_UPSTREAM')
  }
  const images = answer.output
    .filter((content): content is Extract<typeof content, { type: 'image' }> => content.type === 'image')
    .map(content => decodeImage(content.mimeType, content.data))
  if (images.length === 0) {
    throw new MediaError('image generation returned no image content', 'MEDIA_UPSTREAM')
  }
  return { provider: providerId, model: answer.model, images }
}

/**
 * Register the pi-ai image provider on `ctx.media`.
 * @param ctx - context carrying the media seam and, optionally, credentials.
 * @param config - registry key and credential reference.
 */
export function apply(ctx: Context, config: Config): void {
  // schemastery (Config) has already filled every defaulted field.
  const { id, apiKeyEnv } = config as ResolvedConfig
  const upstream = createModels()
  upstream.setProvider(openrouterProvider())

  /** The credential for this provider, or undefined when none is configured. */
  const resolveApiKey = async (): Promise<string | undefined> => {
    const resolved = await ctx.get('credentials')?.resolve(credentialRef(apiKeyEnv))
    return resolved?.value ?? process.env[apiKeyEnv]
  }

  const provider: MediaImageProvider = {
    id,
    // Availability is credential presence, which the seam reads synchronously;
    // the env var is the observable half, and a credentials-service value is
    // resolved per call.
    available: () => process.env[apiKeyEnv] !== undefined || ctx.get('credentials') !== undefined,
    async generateImage(request: MediaImageRequest, signal?: AbortSignal): Promise<MediaImageResult> {
      rejectImageControls(request, ['guidanceScale', 'outputFormat', 'optimizePromptMode'])
      // The route carries no count: it answers with what the model produced, so
      // a call asking for several cannot be honored and is refused instead of
      // returning fewer images than it asked for.
      if (request.n !== undefined && request.n !== 1) {
        throw new MediaError(`n is not supported by ${request.provider ?? request.model}`, 'MEDIA_INVALID_REQUEST')
      }
      const model = upstream.getModelOfType('image', 'openrouter', request.model)
      if (model === undefined) {
        throw new MediaError(
          `"${request.model}" is not an image model this provider serves`,
          'MEDIA_INVALID_REQUEST',
        )
      }
      const apiKey = await resolveApiKey()
      if (apiKey === undefined) {
        throw new MediaError(
          `no credential resolved from ${apiKeyEnv} for media provider "${id}"`,
          'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
        )
      }
      const answer = await upstream.generateImages(model, { input: toInput(request) }, {
        apiKey,
        ...signal === undefined ? {} : { signal },
      })
      return toResult(id, answer)
    },
  }

  ctx.effect(() => ctx.media.registerImageProvider(provider), 'media-pi-ai: image provider')
}
