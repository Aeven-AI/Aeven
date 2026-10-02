/**
 * Subscription image models as `ctx.media` image providers, so a selected
 * Grok Imagine or Codex image model is offered wherever the harness lists
 * image models. A provider is available only while its subscription holds a
 * credential and the user keeps its image model selected.
 * @module @aeven/subscription-auth/media-providers
 */

import { readFile } from 'node:fs/promises'
import { MediaError } from '@aeven/media'
import type { MediaImageModel, MediaImageProvider, MediaImageRequest, MediaImageResult } from '@aeven/media'
import { CODEX_IMAGE_EDIT_URL, CODEX_IMAGE_GENERATION_URL, CODEX_IMAGE_MODEL, decodeImageBase64, detectImageMediaType } from './codex-images.ts'
import { type CodexHttpClient, isRecord } from './codex-http.ts'
import type { GenerateImagineImageInput, ImagineImageResult } from './grok-imagine/types.ts'
import { safeMessage } from './redact.ts'
import { SUBSCRIPTION_IMAGE_MODELS, type SubscriptionImageModel } from './subscription-models.ts'

/** Registry id of the Grok Imagine media provider. */
export const GROK_MEDIA_PROVIDER_ID = 'grok-subscription'
/** Registry id of the Codex image media provider. */
export const CODEX_MEDIA_PROVIDER_ID = 'codex-subscription'

/** Ceiling of one Codex image response envelope: four base64 images of up to 20 MiB each. */
const CODEX_IMAGE_RESPONSE_MAX_BYTES = 4 * Math.ceil((20 * 1024 * 1024) / 3) * 4 + 128 * 1024

/** Live readiness the providers consult on every call. */
export interface SubscriptionMediaGate {
  /** The subscription holds a credential the image endpoint accepts. */
  ready(): boolean
  /** The user keeps this image model selected. */
  isSelected(modelId: string): boolean
}

function selectedModels(
  provider: string,
  models: readonly SubscriptionImageModel[],
  gate: SubscriptionMediaGate,
): MediaImageModel[] {
  if (!gate.ready()) return []
  return models
    .filter(model => gate.isSelected(model.id))
    .map(model => ({ provider, id: model.id, label: model.name }))
}

function requireModel(request: MediaImageRequest, models: readonly SubscriptionImageModel[], gate: SubscriptionMediaGate): void {
  if (!models.some(model => model.id === request.model)) {
    throw new MediaError(`image model "${request.model}" is not offered by this subscription`, 'MEDIA_INVALID_REQUEST')
  }
  if (!gate.isSelected(request.model)) {
    throw new MediaError(`image model "${request.model}" is switched off in Settings → Providers`, 'MEDIA_INVALID_REQUEST')
  }
}

/** The Imagine client operation this provider calls. */
export interface ImagineImageGenerator {
  generateImage(input: GenerateImagineImageInput, signal?: AbortSignal): Promise<ImagineImageResult>
}

/**
 * Grok Imagine through the Grok subscription (or the configured xAI key).
 * The Imagine client stores each image itself; this provider returns those
 * stored bytes so the caller owns where they land.
 * @param imagine - the Imagine client.
 * @param gate - live credential and selection state.
 * @returns the media provider.
 */
export function createGrokMediaProvider(imagine: ImagineImageGenerator, gate: SubscriptionMediaGate): MediaImageProvider {
  const models = SUBSCRIPTION_IMAGE_MODELS.grok
  return {
    id: GROK_MEDIA_PROVIDER_ID,
    available: () => selectedModels(GROK_MEDIA_PROVIDER_ID, models, gate).length > 0,
    listImageModels: () => Promise.resolve(selectedModels(GROK_MEDIA_PROVIDER_ID, models, gate)),
    async generateImage(request, signal): Promise<MediaImageResult> {
      requireModel(request, models, gate)
      if (request.references !== undefined && request.references.length > 0) {
        throw new MediaError('Grok Imagine does not accept reference images', 'MEDIA_INVALID_REQUEST')
      }
      let result: ImagineImageResult
      try {
        result = await imagine.generateImage({
          prompt: request.prompt,
          model: request.model,
          ...(request.n === undefined ? {} : { n: request.n }),
          ...(request.aspectRatio === undefined ? {} : { aspectRatio: request.aspectRatio }),
          ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
        }, signal)
      } catch (error) {
        throw new MediaError(`Grok Imagine failed: ${safeMessage(error)}`, 'MEDIA_UPSTREAM', { cause: error })
      }
      const images = await Promise.all(result.images.map(async image => ({
        kind: 'bytes' as const,
        mediaType: image.attachment.mediaType,
        data: new Uint8Array(await readFile(image.path)),
      })))
      return { provider: GROK_MEDIA_PROVIDER_ID, model: result.model, images }
    },
  }
}

function dataUrl(reference: { mediaType: string; data: Uint8Array }): string {
  return `data:${reference.mediaType};base64,${Buffer.from(reference.data).toString('base64')}`
}

/**
 * Codex image generation (`gpt-image-2`) through the ChatGPT subscription.
 * Reference images turn the request into an edit.
 * @param http - the Codex HTTP client bound to the subscription credential.
 * @param gate - live credential and selection state.
 * @returns the media provider.
 */
export function createCodexMediaProvider(http: CodexHttpClient, gate: SubscriptionMediaGate): MediaImageProvider {
  const models = SUBSCRIPTION_IMAGE_MODELS.codex
  return {
    id: CODEX_MEDIA_PROVIDER_ID,
    available: () => selectedModels(CODEX_MEDIA_PROVIDER_ID, models, gate).length > 0,
    listImageModels: () => Promise.resolve(selectedModels(CODEX_MEDIA_PROVIDER_ID, models, gate)),
    async generateImage(request, signal): Promise<MediaImageResult> {
      requireModel(request, models, gate)
      const references = request.references ?? []
      const body: Record<string, unknown> = {
        prompt: request.prompt,
        model: CODEX_IMAGE_MODEL,
        n: request.n ?? 1,
        size: request.size ?? 'auto',
        quality: 'auto',
        background: request.background ?? 'auto',
        response_format: 'b64_json',
      }
      if (references.length > 0) body['images'] = references.map(reference => ({ image_url: dataUrl(reference) }))
      let payload: unknown
      try {
        payload = await http.requestJson({
          url: references.length === 0 ? CODEX_IMAGE_GENERATION_URL : CODEX_IMAGE_EDIT_URL,
          method: 'POST',
          body,
          maxBytes: CODEX_IMAGE_RESPONSE_MAX_BYTES,
          ...(signal === undefined ? {} : { signal }),
        })
      } catch (error) {
        throw new MediaError(`Codex image generation failed: ${safeMessage(error)}`, 'MEDIA_UPSTREAM', { cause: error })
      }
      const rows = isRecord(payload) && Array.isArray(payload['data']) ? payload['data'] : []
      const images = rows.flatMap((row) => {
        const encoded = isRecord(row) && typeof row['b64_json'] === 'string' ? row['b64_json'] : undefined
        const data = encoded === undefined ? undefined : decodeImageBase64(encoded)
        const mediaType = data === undefined ? undefined : detectImageMediaType(data)
        return data === undefined || mediaType === undefined ? [] : [{ kind: 'bytes' as const, mediaType, data }]
      })
      if (images.length === 0) throw new MediaError('Codex returned no usable image', 'MEDIA_UPSTREAM')
      return { provider: CODEX_MEDIA_PROVIDER_ID, model: CODEX_IMAGE_MODEL, images }
    },
  }
}
