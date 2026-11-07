/** Turn-local indexes of generated image calls and their displayed artifacts. @module */
import type { ToolCallBlock } from '@aeven/client-ui-conversation/client'

/** Image ownership indexes derived from the session log; tool nodes retain the images. */
export interface GeneratedImages {
  /** Atomic image-producing calls, including nested code dispatches, plus connector card calls {@link withConnectorCards} adds. */
  readonly callIds: ReadonlySet<string>
  /** Attachments displayed by those calls. */
  readonly attachmentIds: ReadonlySet<string>
  /** Recorded paths naming those attachments. */
  readonly sources: ReadonlySet<string>
}

/** Connector calls whose card shows what the call read, such as WhatsApp messages; derived from the session log. */
export interface ConnectorCards {
  /** Atomic connector calls that draw a card. */
  readonly callIds: ReadonlySet<string>
}

declare module '@aeven/client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Generated-image presentation indexes contributed by Imagine. */
    'generated-images': GeneratedImages
    /** Connector card calls contributed by the Connectors settings plugin. */
    'connector-cards': ConnectorCards
  }
}

/** No images, for a Turn whose only independently displayed calls are connector cards. */
const NO_IMAGES: GeneratedImages = { callIds: new Set(), attachmentIds: new Set(), sources: new Set() }

/**
 * The calls a Turn displays outside process disclosure: its image calls and its connector card calls.
 * @param images - the Turn's generated-image indexes.
 * @param cards - the Turn's connector card calls.
 * @returns the image indexes with the card calls added to `callIds`; `images` itself when no card call is added.
 */
export function withConnectorCards(images: GeneratedImages | undefined, cards: ConnectorCards | undefined): GeneratedImages | undefined {
  if (cards === undefined || cards.callIds.size === 0) return images
  const base = images ?? NO_IMAGES
  return { ...base, callIds: new Set([...base.callIds, ...cards.callIds]) }
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
