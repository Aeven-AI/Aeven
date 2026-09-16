/** Pure image-card derivation from a settled Tool result's content. @module */
import type { ImageAttachmentRef } from '@aeven/attachment'
import type { ToolCallBlock } from './tool-call-model.ts'

/**
 * Durable image attachments a settled Tool result carries, in content order.
 *
 * A running call and an errored result contribute nothing: the running form
 * has no content yet, and a failed call's partial content is diagnostic rather
 * than a produced artifact. Results without image blocks — every Tool that
 * returns text alone — yield an empty list, which render sites treat as
 * "nothing to show" rather than an empty gallery.
 * @param block - the running or settled call node.
 * @returns the referenced images in content order; empty when there are none.
 */
export function imageCardModel(block: ToolCallBlock): readonly ImageAttachmentRef[] {
  // `kind` is the settled arm's own discriminant: a running call has none.
  if (!('kind' in block) || block.isError) return []
  const images: ImageAttachmentRef[] = []
  for (const content of block.content) {
    if (content.type === 'image') images.push(content.attachment)
  }
  return images
}
