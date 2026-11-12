/**
 * Request, value, and failure vocabulary of the `messageShare` Remote.
 * @module @aeven/host-message-share/types
 */

import type { Branded } from '@aeven/brand'
import type { MessageId } from '@aeven/llm/brand'
import type { SessionId } from '@aeven/session/types'

/** Opaque id of one public share link, assigned by the Aeven API. */
export type MessageShareId = Branded<'MessageShareId'>

/** Opaque position after which the next page of links starts. */
export type MessageShareCursor = Branded<'MessageShareCursor'>

/** One public link the signed-in account created. */
export interface MessageShareLink {
  /** The link's id. */
  readonly shareId: MessageShareId
  /** Public URL anyone holding it can open. */
  readonly url: string
  /** Title shown on the public page and in the link list: the opening of the response. */
  readonly title: string
  /** Session the shared message belongs to. */
  readonly sessionId: SessionId
  /** The shared assistant message. */
  readonly messageId: MessageId
  /** Creation time in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Time the published snapshot was last replaced, in Unix epoch milliseconds. */
  readonly updatedAt: number
}

/** Publish one finalized assistant message, or refresh the link it already has. */
export interface MessageShareCreateRequest {
  /** Persisted Session that owns the message. */
  readonly sessionId: SessionId
  /** Finalized assistant message to publish. */
  readonly messageId: MessageId
}

/** Read one page of the account's links, newest first. */
export interface MessageShareListRequest {
  /** `nextCursor` of the previous page; absent for the first page. */
  readonly cursor?: MessageShareCursor
}

/** One page of the account's links. */
export interface MessageShareListValue {
  /** Links on this page, newest first. */
  readonly items: readonly MessageShareLink[]
  /** Cursor of the next page, or `null` on the last page. */
  readonly nextCursor: MessageShareCursor | null
}

/** Delete one of the account's links. */
export interface MessageShareDeleteRequest {
  /** The link to delete. */
  readonly shareId: MessageShareId
}

/** Outcome of deleting one link. */
export interface MessageShareDeleteValue {
  /** The public page now answers that the link no longer exists. */
  readonly removed: true
}

/** Outcome of deleting every link of the account. */
export interface MessageShareDeleteAllValue {
  /** How many links were deleted. */
  readonly removed: number
}

/**
 * Why a share operation was refused.
 * - `signed-out`: no Aeven account is signed in, or its session expired.
 * - `session-not-found`: the Session is not persisted or belongs to another account.
 * - `target-not-found`: the message is not a finalized assistant message of the Session.
 * - `too-large`: the response or its images exceed what a share may hold.
 * - `share-limit`: the account holds as many links as it may.
 * - `not-found`: the link does not exist or belongs to another account.
 * - `unavailable`: the Aeven API could not be reached or failed.
 */
export type MessageShareFailureCode =
  | 'signed-out'
  | 'session-not-found'
  | 'target-not-found'
  | 'too-large'
  | 'share-limit'
  | 'not-found'
  | 'unavailable'

/** One refused share operation. */
export interface MessageShareFailure {
  readonly code: MessageShareFailureCode
}

/** Successful share operation. */
export interface MessageShareSuccess<T> {
  readonly ok: true
  readonly value: T
}

/** Refused share operation. */
export interface MessageShareRejected {
  readonly ok: false
  readonly error: MessageShareFailure
}

/** Settled share operation. */
export type MessageShareResult<T> = MessageShareSuccess<T> | MessageShareRejected
