/**
 * Session events `@aeven/tool-fs` writes, for readers that import no runtime code.
 * @module @aeven/tool-fs/types
 */

import type { ImageAttachmentRef } from '@aeven/attachment'
import type { SessionSeq } from '@aeven/session'

/** One stored copy of a local image an assistant reply shows. */
export interface ReplyImage {
  /** The `assistant/message` that shows the image. */
  messageSeq: SessionSeq
  /** The image source exactly as that reply wrote it. */
  source: string
  /** The copy in the attachment store. */
  attachment: ImageAttachmentRef
}

declare module '@aeven/session/types' {
  interface SessionEventMap {
    /**
     * Durable copies of local images the Turn's assistant replies show as
     * Markdown images, saved before the Turn closed. Log-only: it never enters
     * model context or derived history.
     * @param turn - the Turn whose replies show the images.
     * @param images - each copy, with the reply that shows it and its written source.
     */
    'reply-images/stored': { turn: number; images: ReplyImage[] }
  }
}
