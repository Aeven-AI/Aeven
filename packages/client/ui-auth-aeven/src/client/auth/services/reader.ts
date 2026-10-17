/**
 * The signed-in reader, published where a plugin bundle can read it.
 *
 * This library is linked into the boot kernel, because the gate runs before
 * the plugin graph exists; a plugin bundle therefore cannot import it and
 * reach this session. So the gate states the reader on the page, the same way
 * the Host states the endpoints, and any plugin reads it from there.
 * @module
 */

import { mediaUrl, webUrl } from './config.ts'
import { cloud, mfa, removeAvatar, setDisplayName, signOut, uploadAvatar } from './api.ts'
import { session } from './session.ts'

/** What a plugin may know about the signed-in reader. */
export interface AevenReader {
  /** Aeven user id. */
  readonly userId: string
  /** Chosen display name, absent until the reader sets one. */
  readonly displayName?: string
  /** Sign-in email address, absent for an account that has none. */
  readonly email?: string
  /** Absolute URL of the uploaded picture, absent until the reader sets one. */
  readonly imageUrl?: string
  /** The Aeven account page, absent when this deployment names no web client. */
  readonly accountUrl?: string
  /** End the Aeven session; the caller decides where the reader goes next. */
  readonly signOut: () => Promise<void>
  /**
   * Store the name Aeven calls the reader by — the same account name the
   * sign-up naming step asks for — and restate the reader with it, so the
   * account menu and the next message carry the new name.
   * @param displayName - the name to store, trimmed.
   * @returns the name the API stored.
   */
  readonly setDisplayName: (displayName: string) => Promise<string>
  /**
   * Replace the account's picture with the picture the reader picked, and
   * restate the reader with it, so every surface that draws the reader follows.
   * @param image - the file the reader picked.
   * @returns the picture's absolute URL, absent when the account now has none.
   */
  readonly setImage: (image: Blob) => Promise<string | undefined>
  /**
   * Remove the account's picture, leaving the initial in its place.
   * @returns nothing; the restated reader has no picture.
   */
  readonly removeImage: () => Promise<void>
  /** Authenticator operations authenticated as this reader; secrets remain in server storage. */
  readonly mfa: typeof mfa
  /**
   * Call one of Aeven's `/api/cloud` account routes as this reader.
   * @param path - the route below `/api/cloud`, starting with `/`.
   * @param init - method and body; the credential is supplied.
   * @returns the decoded response body.
   */
  readonly cloud: <T>(path: string, init?: RequestInit) => Promise<T>
}

/** Page global carrying the reader. */
interface ReaderScope {
  __AVN_AEVEN_READER__?: AevenReader
}

/**
 * State the restored reader on the page.
 *
 * A page with nobody signed in states nothing, so a plugin reading the global
 * sees the same absence whether the gate ran and found no session or no Aeven
 * authority is configured at all.
 */
export function publishReader(): void {
  const scope = globalThis as ReaderScope
  if (!session.userSignedIn || session.userId === null) {
    delete scope.__AVN_AEVEN_READER__
    return
  }
  const web = webUrl()
  const imageUrl = imageUrlOf()
  scope.__AVN_AEVEN_READER__ = {
    userId: session.userId,
    ...session.displayName === undefined ? {} : { displayName: session.displayName },
    ...session.email === undefined ? {} : { email: session.email },
    ...imageUrl === undefined ? {} : { imageUrl },
    ...web === undefined ? {} : { accountUrl: `${web}/account/` },
    signOut,
    setDisplayName: async (displayName: string) => {
      const stored = await setDisplayName(displayName)
      publishReader()
      return stored
    },
    setImage: async (image: Blob) => {
      await uploadAvatar(image)
      publishReader()
      return imageUrlOf()
    },
    removeImage: async () => {
      await removeAvatar()
      publishReader()
    },
    cloud,
    mfa,
  }
}

/**
 * The picture URL the account's stored path resolves to.
 * @returns the absolute URL, absent when the account has no picture or the deployment names no media origin.
 */
function imageUrlOf(): string | undefined {
  const path = session.profile?.avatar?.url
  const media = mediaUrl()
  return path === undefined || media === undefined ? undefined : `${media}${path}`
}

/**
 * Read the stated reader.
 * @returns the reader, or undefined when nobody is signed in.
 */
export function publishedReader(): AevenReader | undefined {
  return (globalThis as ReaderScope).__AVN_AEVEN_READER__
}
