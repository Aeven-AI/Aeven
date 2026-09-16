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
  /**
   * Remove one key.
   * @param key - the storage key.
   */
  removeItem(key: string): void {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // As above: a store that refuses removal held nothing readable anyway.
    }
  },
}

/** Storage key holding the last profile `/get-profile` answered with. */
const PROFILE_KEY = 'aevenProfile'

/**
 * Keep a profile for a load that cannot reach Aeven.
 * @param data - the profile to keep.
 */
export function cacheProfile(data: AevenProfile): void {
  storage.setItem(PROFILE_KEY, JSON.stringify(data))
}

/**
 * The last profile Aeven answered with.
 * @returns the kept profile, or undefined when none was kept or it will not parse.
 */
export function cachedProfile(): AevenProfile | undefined {
  const raw = storage.getItem(PROFILE_KEY)
  if (raw === null) return undefined
  try {
    const parsed = JSON.parse(raw) as AevenProfile
    return typeof parsed.userId === 'string' && parsed.userId !== '' ? parsed : undefined
  } catch {
    // Unparsable storage holds no profile; the next successful read replaces it.
    return undefined
  }
}

/** Discard the kept profile, so a signed-out browser holds nothing about them. */
export function forgetCachedProfile(): void {
  storage.removeItem(PROFILE_KEY)
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
   * Adopt what `/get-profile` answered, and keep it for a load that cannot ask.
   * @param data - the profile response.
   */
  adoptProfile(data: AevenProfile): void {
    this.userId = data.userId
    this.email = data.email
    this.displayName = data.displayName
    this.profile = data.profile
    this.userSignedIn = true
    cacheProfile(data)
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
