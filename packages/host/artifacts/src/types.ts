/**
 * Request and value vocabulary of the `artifacts` Remote.
 * @module @aeven/host-artifacts/types
 */

import type { Branded } from '@aeven/brand'
import type { SessionId } from '@aeven/session/types'

/** Opaque id of one artifact: stable while its Session and path stay the same. */
export type ArtifactId = Branded<'ArtifactId'>

/** Opaque position after which the next page of Sessions is scanned. */
export type ArtifactCursor = Branded<'ArtifactCursor'>

/**
 * What an artifact is. A file's kind is decided by its extension; `motion` is a Motion film, a folder of
 * HTML scenes played as one video, listed by its `index.html`.
 */
export type ArtifactKind = 'document' | 'slides' | 'pdf' | 'page' | 'image' | 'video' | 'motion'

/** One finished file Aeven created. */
export interface Artifact {
  /** The artifact's id. */
  readonly id: ArtifactId
  /** Session whose tool call created the file. */
  readonly sessionId: SessionId
  /** The file's path as the tool recorded it: absolute, or relative to the Session's working directory. */
  readonly path: string
  /** The file's name with its extension; a Motion film's folder name. */
  readonly name: string
  /**
   * What the artifact is called: a page's own `<title>`, else the readable name of the folder that holds a
   * file with a generic name such as `index.html`, else the conversation's title, else the file name.
   */
  readonly title: string
  /** What the file is. */
  readonly kind: ArtifactKind
  /** Time the creating tool result was logged, in Unix epoch milliseconds. */
  readonly createdAt: number
  /** Attachment id of the file's stored copy, absent when the tool result stored none. */
  readonly attachmentId?: string | undefined
  /** For a Motion film, the `show_motion` call that last showed it, from which the Host can rebuild the film. */
  readonly callId?: string | undefined
  /**
   * What the file is one export of, when the Session made it as part of a set: `resume` for a résumé the CV skill
   * built, `deck` for a slide deck. Read from the skill's source file in the same folder, `cv.json` or `deck.json`,
   * or, for a deck, from a slides file of the same name.
   */
  readonly family?: 'resume' | 'deck' | undefined
  /**
   * Whether the artifact exists only as its stored copy, such as a generated picture or clip: `path` is then the
   * copy's name rather than a file, and `attachmentId` is always set.
   */
  readonly stored?: true | undefined
  /**
   * Whether the file is not on this device now, such as one deleted, moved, or made on another device, and its
   * stored copy stands for it. An artifact with neither its file nor a stored copy is not listed.
   */
  readonly missing?: true | undefined
  /**
   * Opaque token of the file's current version on this device, absent when the file is missing. It changes
   * whenever the file does, so an address carrying it names one version and may be cached for good.
   */
  readonly version?: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A Session running on this Host changed its artifacts: it made, changed or linked a file, was renamed, or was
     * rewound. Sent only when the list differs from the one last sent for that Session.
     * @mode emit
     * @param sessionId - the Session.
     * @param items - all of that Session's artifacts that can be shown, newest first.
     */
    'artifacts/change'(sessionId: SessionId, items: readonly Artifact[]): void
  }
}

/** Read one page of artifacts. */
export interface ArtifactListRequest {
  /** The previous page's `nextCursor`; absent starts at the newest Session. */
  readonly cursor?: ArtifactCursor | undefined
}

/** One page of artifacts: those of the next Sessions in newest-first order. */
export interface ArtifactListValue {
  /** Artifacts of the Sessions this page scanned, newest first. */
  readonly items: readonly Artifact[]
  /** Cursor for the next page, or `null` when every Session has been scanned. */
  readonly nextCursor: ArtifactCursor | null
  /** Sessions scanned up to and including this page. */
  readonly scanned: number
  /** Sessions of the signed-in account in total. */
  readonly total: number
}
