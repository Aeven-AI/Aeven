/**
 * The share entry's injected face. The target
 * 'conversation.chat.assistant-actions' slot is declared and typed by
 * ui-conversation; this package only contributes the entry, so no SlotMap
 * merge lives here.
 * @module @aeven/client-ui-message-share/client/slots
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import type { MessageId } from '@aeven/api-remotes/client'
import type {
  MessageShareCursor, MessageShareDeleteAllValue, MessageShareDeleteValue, MessageShareFailureCode,
  MessageShareId, MessageShareLink, MessageShareListValue,
} from '@aeven/host-message-share/types'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'share' seat).
import type {} from './locales.ts'

/** A settled share call: its value, or the failure code the dialogs translate. */
export type ShareOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: MessageShareFailureCode }

/** The link verbs one Session's share entries call. */
export interface MessageShareInjected {
  /**
   * Publish one assistant message, or refresh the link it already has.
   * @param messageId - the finalized assistant message.
   */
  share: (messageId: MessageId) => Promise<ShareOutcome<MessageShareLink>>
  /**
   * Read one page of the signed-in account's links, newest first.
   * @param cursor - the previous page's cursor; absent for the first page.
   */
  list: (cursor?: MessageShareCursor) => Promise<ShareOutcome<MessageShareListValue>>
  /**
   * Delete one link.
   * @param shareId - the link to delete.
   */
  remove: (shareId: MessageShareId) => Promise<ShareOutcome<MessageShareDeleteValue>>
  /** Delete every link of the signed-in account. */
  removeAll: () => Promise<ShareOutcome<MessageShareDeleteAllValue>>
}

/** Full props of one assistant-message share entry. */
export type MessageShareActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<MessageShareInjected>
  & PropsLocale<'share'>
