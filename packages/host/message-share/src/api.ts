/**
 * Client of the Aeven API's `/api/shares` routes.
 *
 * Every call carries the signed-in user's own Aeven access token, so the API files each
 * link under that account and lists and deletes only that account's links.
 * @module @aeven/host-message-share/api
 */

import { Buffer } from 'node:buffer'
import { z } from 'zod'
import type { MessageId } from '@aeven/llm/brand'
import type { SessionId } from '@aeven/session/types'
import type { ShareSnapshot } from './snapshot.ts'
import type {
  MessageShareCursor, MessageShareFailureCode, MessageShareId, MessageShareLink, MessageShareListValue,
} from './types.ts'

const linkSchema = z.object({
  shareId: z.string().min(1).transform(value => value as MessageShareId),
  url: z.url(),
  title: z.string(),
  sessionId: z.string().min(1).transform(value => value as SessionId),
  messageId: z.string().min(1).transform(value => value as MessageId),
  createdAt: z.number(),
  updatedAt: z.number(),
})

const listSchema = z.object({
  items: z.array(linkSchema),
  nextCursor: z.string().min(1).transform(value => value as MessageShareCursor).nullable(),
})

const removedSchema = z.object({ removed: z.literal(true) })
const removedCountSchema = z.object({ removed: z.number().int().nonnegative() })

/** A refused API call; `code` is the share failure it maps to. */
export class ShareApiError extends Error {
  /** @param code - the share failure code. */
  constructor(readonly code: MessageShareFailureCode) {
    super(`aeven shares api: ${code}`)
    this.name = 'ShareApiError'
  }
}

/** Settings for one {@link ShareApi}. */
export interface ShareApiOptions {
  /** Aeven API origin, such as `http://localhost:9000`. */
  readonly apiUrl: string
  /** Budget for one call. */
  readonly timeoutMs: number
  /** The user's current Aeven access token, or undefined when that user has no live session. */
  readonly sessionToken: (owner: string) => Promise<string | undefined>
}

/** Calls `/api/shares` as one signed-in user. */
export class ShareApi {
  /** @param options - API origin, call budget, and the per-user token source. */
  constructor(private readonly options: ShareApiOptions) {}

  /**
   * Publish a snapshot, or refresh the link the message already has.
   * @param owner - the signed-in account.
   * @param target - Session and message the snapshot came from.
   * @param snapshot - the published content.
   * @returns the link.
   */
  async create(
    owner: string,
    target: { readonly sessionId: SessionId; readonly messageId: MessageId },
    snapshot: ShareSnapshot,
  ): Promise<MessageShareLink> {
    return linkSchema.parse(await this.call(owner, 'POST', '/api/shares', {
      sessionId: target.sessionId,
      messageId: target.messageId,
      title: snapshot.title,
      response: snapshot.response,
      images: snapshot.images.map(image => ({ mediaType: image.mediaType, data: Buffer.from(image.data).toString('base64') })),
    }))
  }

  /**
   * Read one page of the account's links.
   * @param owner - the signed-in account.
   * @param cursor - the previous page's `nextCursor`.
   * @returns the page.
   */
  async list(owner: string, cursor: MessageShareCursor | undefined): Promise<MessageShareListValue> {
    const query = cursor === undefined ? '' : `?cursor=${encodeURIComponent(cursor)}`
    return listSchema.parse(await this.call(owner, 'GET', `/api/shares${query}`))
  }

  /**
   * Delete one of the account's links.
   * @param owner - the signed-in account.
   * @param shareId - the link.
   */
  async remove(owner: string, shareId: MessageShareId): Promise<void> {
    removedSchema.parse(await this.call(owner, 'DELETE', `/api/shares/${encodeURIComponent(shareId)}`))
  }

  /**
   * Delete every link of the account.
   * @param owner - the signed-in account.
   * @returns how many links were deleted.
   */
  async removeAll(owner: string): Promise<number> {
    return removedCountSchema.parse(await this.call(owner, 'DELETE', '/api/shares')).removed
  }

  private async call(owner: string, method: string, path: string, body?: unknown): Promise<unknown> {
    const token = await this.options.sessionToken(owner)
    if (token === undefined || token === '') throw new ShareApiError('signed-out')
    let response: Response
    try {
      response = await fetch(`${this.options.apiUrl.replace(/\/+$/, '')}${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...body === undefined ? {} : { 'Content-Type': 'application/json' } },
        ...body === undefined ? {} : { body: JSON.stringify(body) },
        signal: AbortSignal.timeout(this.options.timeoutMs),
        redirect: 'error',
      })
    } catch {
      // A network failure or timeout carries no detail worth surfacing; the caller reports the API as unavailable.
      throw new ShareApiError('unavailable')
    }
    if (response.ok) return await response.json()
    const error = await response.json().then(value => (value as { error?: unknown } | null)?.error, () => undefined)
    if (response.status === 401) throw new ShareApiError('signed-out')
    if (response.status === 404) throw new ShareApiError('not-found')
    // Only the shares API's own codes mean too large; a bare 413 comes from a proxy or an API without these routes.
    if (typeof error === 'string' && /too-large|too-many-images/.test(error)) throw new ShareApiError('too-large')
    if (error === 'share-limit') throw new ShareApiError('share-limit')
    throw new ShareApiError('unavailable')
  }
}
