/**
 * The image-model catalog served to Host-generation selectors.
 *
 * The media seam is optional in every profile, so this reads it through
 * `ctx.get` and answers an empty catalog where none is composed: a selector
 * asking a deployment without image generation gets an empty list rather than
 * an error it would have to special-case.
 *
 * The seam's types are declared structurally rather than imported, so this
 * controller gains no dependency on a capability it only reports.
 * @module @deepseek-ai/dsh-api-session-controller/image-catalog
 */

import type { Context } from '@deepseek-ai/cordis'

/** One image model a provider serves. */
export interface ImageModelEntry {
  /** Provider route id that serves this model; what a request names. */
  provider: string
  /** The provider's model id, verbatim. */
  id: string
  /** Human-readable name where the provider's catalog states one. */
  label?: string
  /** One-line note a selector can show beside the label. */
  description?: string
}

/** Every image model this deployment can reach, grouped by nothing: order is registration order. */
export interface ImageModelCatalog {
  /** The models, in provider registration order; empty where no media seam is composed. */
  models: ImageModelEntry[]
}

/** The part of `ctx.media` this catalog reads. */
interface ImageModelSource {
  listImageModels(signal?: AbortSignal): Promise<readonly ImageModelEntry[]>
}

/**
 * Read every image model the composed providers publish.
 * @param ctx - Host context that may carry the media seam.
 * @returns the catalog, empty where no seam or no provider publishes one.
 */
export async function buildImageModelCatalog(ctx: Context): Promise<ImageModelCatalog> {
  const media = ctx.get('media') as unknown as ImageModelSource | undefined
  if (media === undefined) return { models: [] }
  return { models: [...await media.listImageModels()] }
}
