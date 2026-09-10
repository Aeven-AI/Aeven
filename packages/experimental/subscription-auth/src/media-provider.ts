/**
 * Grok Imagine as an image provider for the generated-media seam (`ctx.media`).
 *
 * The seam is what lets one model-facing tool offer this subscription's model
 * beside every API-key provider, so a person chooses a model instead of the
 * agent choosing between competing tools. Nothing here registers a tool: the
 * standalone Imagine tools stay as they were, and a deployment wanting only the
 * unified surface turns them off through their capability toggles.
 *
 * Generated images are already durable — the client downloads them under its
 * own host and size controls and writes them through `ctx.attachments` — so
 * this yields the seam's `attachment` form and no bytes are read back or
 * copied.
 *
 * The seam's types are declared structurally rather than imported: the seam
 * package is not published, and this plugin resolves its harness dependencies
 * from the registry. The shapes below are the parts of that contract this
 * provider implements, and a host whose seam has moved on fails at
 * registration rather than silently mis-serving a call.
 * @module @deepseek-ai/dsh-experimental-subscription-auth/media-provider
 */

import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { CapabilityImagineClient } from './capability-tools.ts'
import { CODEX_IMAGE_MODEL, type CodexImageController } from './codex-images.ts'
import { GROK_BUILD_IMAGINE_IMAGE_MODEL, GROK_IMAGINE_IMAGE_MODEL } from './grok-imagine.ts'

/** Registry key this provider claims under `ctx.media`. */
export const IMAGINE_MEDIA_PROVIDER_ID = 'grok-imagine'

/** The seam's image request, as far as this provider reads it. */
export interface SeamImageRequest {
  readonly model: string
  readonly prompt: string
  readonly n?: number
  readonly aspectRatio?: string
  readonly resolution?: string
}

/** The seam's image result, as far as this provider produces one. */
export interface SeamImageResult {
  readonly provider: string
  readonly model: string
  readonly images: readonly { readonly kind: 'attachment'; readonly attachment: ImageAttachmentRef }[]
}

/** One image model a provider serves, as the seam's catalog reports it. */
export interface SeamImageModel {
  readonly provider: string
  readonly id: string
  readonly label?: string
  readonly description?: string
}

/** The seam's image provider contract. */
export interface SeamImageProvider {
  readonly id: string
  available(): boolean
  generateImage(request: SeamImageRequest, signal?: AbortSignal): Promise<SeamImageResult>
  listImageModels?(signal?: AbortSignal): Promise<readonly SeamImageModel[]>
}

/** The registry this provider is handed to. */
export interface SeamImageRegistry {
  registerImageProvider(provider: SeamImageProvider): () => void
}

/** What the provider needs from the plugin's own wiring. */
export interface ImagineMediaProviderOptions {
  /** Registry key; defaults to {@link IMAGINE_MEDIA_PROVIDER_ID}. */
  readonly id?: string
  /** The routed Imagine client, so generated images stay reachable on the plugin's own routes. */
  readonly imagine: Pick<CapabilityImagineClient, 'generateImage'>
}

/**
 * Translate one seam request into the Imagine client's input.
 *
 * `model` passes through verbatim and the client validates it against the
 * resolved transport, so an unsupported id fails there by name rather than
 * being silently replaced. A request naming none takes the subscription's
 * image model.
 * @param request - the seam request.
 * @returns the Imagine input.
 */
export function toImagineInput(request: SeamImageRequest): {
  prompt: string
  model: string
  n?: number
  aspectRatio?: string
  resolution?: string
} {
  return {
    prompt: request.prompt,
    model: request.model === '' ? GROK_IMAGINE_IMAGE_MODEL : request.model,
    ...(request.n === undefined ? {} : { n: request.n }),
    ...(request.aspectRatio === undefined ? {} : { aspectRatio: request.aspectRatio }),
    ...(request.resolution === undefined ? {} : { resolution: request.resolution }),
  }
}

/**
 * Build the Imagine image provider for `ctx.media`.
 * @param options - the registry key and the routed Imagine client.
 * @returns the seam provider; the caller registers it.
 */
export function createImagineImageProvider(options: ImagineMediaProviderOptions): SeamImageProvider {
  const id = options.id ?? IMAGINE_MEDIA_PROVIDER_ID
  return {
    id,
    // The subscription credential is resolved per call by the client, which
    // reports a missing one as its own error naming the operation.
    available: () => true,
    // A fixed pair rather than a fetched document: Imagine publishes no model
    // list, and these are the two ids the client accepts.
    listImageModels: () => Promise.resolve([
      { provider: id, id: GROK_IMAGINE_IMAGE_MODEL, label: 'Grok Imagine', description: 'Your Grok subscription' },
      {
        provider: id,
        id: GROK_BUILD_IMAGINE_IMAGE_MODEL,
        label: 'Grok Imagine Quality',
        description: 'Your Grok subscription — higher quality',
      },
    ]),
    async generateImage(request: SeamImageRequest, signal?: AbortSignal): Promise<SeamImageResult> {
      const result = await options.imagine.generateImage(toImagineInput(request), signal)
      const images = result.images.map(image => ({
        kind: 'attachment' as const,
        attachment: image.attachment as ImageAttachmentRef,
      }))
      if (images.length === 0) {
        throw new Error('Grok Imagine returned no image')
      }
      return { provider: id, model: result.model, images }
    },
  }
}

/** Registry key the Codex image provider claims under `ctx.media`. */
export const CODEX_MEDIA_PROVIDER_ID = 'codex'

/** What the Codex provider needs from the plugin's own wiring. */
export interface CodexMediaProviderOptions {
  /** Registry key; defaults to {@link CODEX_MEDIA_PROVIDER_ID}. */
  readonly id?: string
  /** Builds a controller for one generation. */
  readonly createController: () => CodexImageController
  /** How many images a call may request, read per call from live settings. */
  readonly imageCount: () => number
}

/**
 * Build the Codex image provider for `ctx.media`.
 *
 * The controller is built with an empty conversation context: the seam's
 * request carries a prompt and nothing else, so a generation through this
 * provider sees no chat history. That is the whole difference from the
 * `codex_image_generate` tool, which derives messages from its execution and
 * stays the surface to use when that context matters.
 * @param options - the registry key, the controller factory, and the image count.
 * @returns the seam provider; the caller registers it.
 */
export function createCodexImageProvider(options: CodexMediaProviderOptions): SeamImageProvider {
  const id = options.id ?? CODEX_MEDIA_PROVIDER_ID
  return {
    id,
    available: () => true,
    // The subscription serves one image model, which the controller pins.
    listImageModels: () => Promise.resolve([
      { provider: id, id: CODEX_IMAGE_MODEL, label: 'GPT Image', description: 'Your Codex subscription' },
    ]),
    async generateImage(request: SeamImageRequest, signal?: AbortSignal): Promise<SeamImageResult> {
      const result = await options
        .createController()
        .generate({ prompt: request.prompt, n: request.n ?? options.imageCount() }, signal)
      const images = result.images.map(attachment => ({ kind: 'attachment' as const, attachment }))
      if (images.length === 0) {
        throw new Error('Codex images returned no image')
      }
      return { provider: id, model: result.model, images }
    },
  }
}
