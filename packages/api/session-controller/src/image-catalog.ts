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
 * @module @aeven/api-session-controller/image-catalog
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ImageModelCatalog, ImageModelEntry } from './types.ts'

// The catalog types live on the `./types` subpath: they cross the remote
// boundary, and typert requires such types to be reachable from a public
// non-root type entry rather than only from this module.
export type { ImageModelCatalog, ImageModelEntry } from './types.ts'

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
