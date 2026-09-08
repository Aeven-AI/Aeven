/**
 * The signed-in user the Aeven screens read, and the storage they keep it in.
 *
 * Aeven's UserService is a singleton of some forty accessors covering the whole
 * app; the sign-in screens read five of them. This carries those, with the same
 * storage keys and the same `appBearers` shape, so a session started in either
 * client is understood by the other.
 * @module
 */

/** The uploaded profile image, absent until a reader sets one. */
export interface AevenProfileMedia {
  readonly avatar?: { readonly url?: string }
}

/** What `/get-profile` answers with; unread fields pass through untouched. */
export interface AevenProfile {
  readonly userId: string
  readonly email?: string
  readonly displayName?: string
  readonly profile?: AevenProfileMedia
  readonly roles?: readonly string[]
}

/** The bundle the OAuth-result screen hands to its children. */
export interface UserConfig {
  readonly userId: string | null
  readonly email: string | undefined
  readonly displayName: string | undefined
  readonly profile: AevenProfileMedia | undefined
  readonly userSignedIn: boolean
}

/** Browser storage, tolerating a browser that refuses it. */
export const storage = {
  /**
   * Read one key.
   * @param key - the storage key.
   * @returns the stored string, or null when absent or unreadable.
   */
  getItem(key: string): string | null {
    try {
      return window.localStorage.getItem(key)
    } catch {
      // Private modes and blocked site data throw on access; an unreadable
      // store is an absent session, which the caller already handles.
      return null
    }
  },
  /**
   * Write one key.
   * @param key - the storage key.
   * @param value - the value to store.
   */
  setItem(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value)
    } catch {
      // As above: a session that cannot be persisted still works for this page.
    }
  },
}

/**
 * The current user, held for the life of the page.
 *
 * A module-level singleton because that is what the ported screens expect: they
 * construct their services freely and rely on every instance seeing the same
 * user.
 */
class Session {
  userId: string | null = null
  userSignedIn = false
  email: string | undefined
  displayName: string | undefined
  profile: AevenProfileMedia | undefined

  /** The bundle the OAuth-result screen passes down. */
  get userConfig(): UserConfig {
    return {
      userId: this.userId,
      email: this.email,
      displayName: this.displayName,
      profile: this.profile,
      userSignedIn: this.userSignedIn,
    }
  }

  /**
   * Adopt what `/get-profile` answered.
   * @param data - the profile response.
   */
  adoptProfile(data: AevenProfile): void {
    this.userId = data.userId
    this.email = data.email
    this.displayName = data.displayName
    this.profile = data.profile
    this.userSignedIn = true
  }

  /** Forget the user, leaving the page signed out. */
  reset(): void {
    this.userId = null
    this.userSignedIn = false
    this.email = undefined
    this.displayName = undefined
    this.profile = undefined
  }
}

/** The page's single signed-in user, shared by every ported screen. */
export const session = new Session()
