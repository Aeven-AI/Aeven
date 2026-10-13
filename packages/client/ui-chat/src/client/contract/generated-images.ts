/** Turn-local indexes of generated image calls and their displayed artifacts. @module */
import type { ToolCallBlock } from '@aeven/client-ui-conversation/client'

/** Image ownership indexes derived from the session log; tool nodes retain the images. */
export interface GeneratedImages {
  /** Atomic image-producing calls, including nested code dispatches. */
  readonly callIds: ReadonlySet<string>
  /** Attachments displayed by those calls. */
  readonly attachmentIds: ReadonlySet<string>
  /** Recorded paths naming those attachments. */
  readonly sources: ReadonlySet<string>
}

declare module '@aeven/client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Generated-image presentation indexes contributed by Imagine. */
    'generated-images': GeneratedImages
  }
}

/**
 * Whether a call tree contains an independently displayed image call.
 * @param block - existing tool-call tree.
 * @param images - the Turn's generated-image indexes.
 * @returns whether the tree must remain visible outside process disclosure.
 */
export function hasGeneratedImageCall(block: ToolCallBlock, images: GeneratedImages | undefined): boolean {
  return images !== undefined && (images.callIds.has(block.callId)
    || block.subCalls.some(child => hasGeneratedImageCall(child, images)))
}
