/** Message media read through the Host for connector cards, kept as object URLs for the page's lifetime. @module */
import type { WhatsAppMessageMedia } from '@aeven/api-remotes/client'

/** One message's media, ready to show or play. */
export interface LoadedMedia {
  /** Object URL of the bytes. */
  readonly url: string
  readonly contentType: string
  readonly data: Uint8Array
}

/** Loads the media of messages of one account. */
export interface MessageMediaSource {
  /**
   * Load one message's media; repeated calls for the same message share one read.
   * @param chatJid - chat JID of the message.
   * @param messageId - message ID.
   * @returns the media, or undefined when the account has none it can fetch.
   */
  load(chatJid: string, messageId: string): Promise<LoadedMedia | undefined>
}

/** Media sources per account, sharing one cache of reads. */
export interface MessageMediaCache {
  /**
   * The source of the account a connector tool name names.
   * @param toolName - a message-reading call's tool name.
   * @returns that account's source; the same object for the same name.
   */
  sourceFor(toolName: string): MessageMediaSource
  /** Release every object URL. */
  dispose(): void
}

/**
 * Create the media cache.
 * @param read - reads one message's media through the Host.
 * @returns the cache.
 */
export function createMessageMediaCache(
  read: (toolName: string, chatJid: string, messageId: string) => Promise<WhatsAppMessageMedia | undefined>,
): MessageMediaCache {
  const reads = new Map<string, Promise<LoadedMedia | undefined>>()
  const sources = new Map<string, MessageMediaSource>()
  const urls: string[] = []
  return {
    sourceFor(toolName) {
      let source = sources.get(toolName)
      if (source === undefined) {
        source = {
          load(chatJid, messageId) {
            const key = `${toolName}\u0000${chatJid}\u0000${messageId}`
            let pending = reads.get(key)
            if (pending === undefined) {
              pending = read(toolName, chatJid, messageId).then((media) => {
                if (media === undefined) return undefined
                const binary = atob(media.base64)
                const data = new Uint8Array(binary.length)
                for (let index = 0; index < binary.length; index += 1) data[index] = binary.charCodeAt(index)
                const url = URL.createObjectURL(new Blob([data.buffer], { type: media.contentType }))
                urls.push(url)
                return { url, contentType: media.contentType, data }
              })
              // A failed read is retried the next time a card asks.
              pending.catch(() => { reads.delete(key) })
              reads.set(key, pending)
            }
            return pending
          },
        }
        sources.set(toolName, source)
      }
      return source
    },
    dispose() {
      for (const url of urls.splice(0)) URL.revokeObjectURL(url)
      reads.clear()
      sources.clear()
    },
  }
}
