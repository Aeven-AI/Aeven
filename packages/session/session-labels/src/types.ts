/**
 * Session bookmark payloads and the wire view a client reads.
 * @module @aeven/session-labels/src/types
 */

import type { SessionSeq } from '@aeven/session/types'

/** One labelled point in a session log. */
export interface SessionLabel {
  /** The event the bookmark points at. */
  readonly at: SessionSeq
  /** The label the user gave this point; never empty. */
  readonly label: string
}

/** The `session/label` event's payload. */
export interface SessionLabelEventData {
  /** The event the bookmark points at; any logged `seq` of this session. */
  readonly at: SessionSeq
  /** The label to set, or an empty string to remove the bookmark at `at`. */
  readonly label: string
}

/** One bookmark in fold state; a `seq` carries at most one label. */
export interface SessionLabelRow {
  /** The bookmarked event. */
  readonly at: SessionSeq
  /** The label at that point; never empty. */
  readonly label: string
}

/** Fold state: label rows kept in ascending `seq` order. */
export interface SessionLabelsState {
  /** Bookmarks in log order. */
  readonly labels: readonly SessionLabelRow[]
}

export {}

declare module '@aeven/session-projection/types' {
  interface SessionProjectionStateMap {
    /** Bookmark fold state, one row per bookmarked seq. */
    sessionLabels: SessionLabelsState
  }
  interface SessionProjectionMap {
    /** Every bookmark in log order; see {@link SessionLabel}. */
    sessionLabels: readonly SessionLabel[]
  }
}
