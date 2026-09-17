/**
 * The helpers the Aeven screens call.
 *
 * Five functions from a toolbox of some 1,500 lines. The two validation rules
 * are carried over exactly, so the screens accept and reject what Aeven does.
 * @module
 */

/** Aeven's password rule, copied verbatim. */
const PASSWORD = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[\W_]).{8,}$/

/** `email-validator`'s own expression, inlined so the dependency is not needed. */
const EMAIL =
  /^[-!#$%&'*+/0-9=?A-Z^_a-z`{|}~](\.?[-!#$%&'*+/0-9=?A-Z^_a-z`{|}~])*@[a-zA-Z0-9](-*\.?[a-zA-Z0-9])*\.[a-zA-Z](-?[a-zA-Z0-9])+$/

/**
 * A component-scoped identifier, used as the key a screen removes its own
 * event listeners under.
 * @returns the identifier.
 */
export function guid(): string {
  let d = Date.now()
  return 'xxxxxxxxxxxxxaxxxxxxxxxxxxxxxxxxxx'.replace(/[x]/g, (c) => {
    const r = (d + Math.random() * 16) % 16 | 0
    d = Math.floor(d / 16)
    /* v8 ignore next -- the pattern replaces only 'x'; the literal 'a' in the
       template is what the other arm was written for and never reaches here. */
    return (c === 'x' ? r : (r & 0x7) | 0x8).toString(16)
  })
}

/**
 * The href for a path.
 *
 * AVN serves these screens as ordinary paths, so a path is already its own
 * href; the Aeven client's hash-route branch has no counterpart here.
 * @param path - the path.
 * @param trailingSlash - accepted because the ported screens pass it; AVN's
 * routes match with or without it, so it changes nothing.
 * @returns the path to navigate to.
 */
export function href(path: string, trailingSlash = false): string {
  return trailingSlash && !path.endsWith('/') ? `${path}/` : path
}

/**
 * Whether an address is one the API will accept.
 * @param email - the address.
 * @returns true when it is well formed.
 */
export function isEmail(email: string): boolean {
  if (email.length > 254) return false
  const parts = email.split('@')
  // `split` always yields a first element; the index signature does not say so.
  if (parts.length !== 2 || (parts[0] as string).length > 64) return false
  return EMAIL.test(email)
}

/**
 * Whether a password meets Aeven's rule: eight or more characters with a
 * lower case, an upper case, a digit, and a symbol.
 * @param password - the password.
 * @returns true when it qualifies.
 */
export function isValidPassword(password: string): boolean {
  return PASSWORD.test(password)
}

/**
 * A structural copy.
 * @param source - the value to copy.
 * @returns the copy.
 */
export function cloneObject<T>(source: T): T {
  return JSON.parse(JSON.stringify(source)) as T
}

/** Zero-width characters a paste can carry invisibly into a name. */
const ZERO_WIDTH = /[\u200B-\u200D\uFEFF]/g

/**
 * Strip what a reader cannot see from what they typed, as the API does before
 * it stores a name.
 *
 * A name is shown back to the reader and to whoever they work with, so a field
 * holding only zero-width characters is empty however long it looks — the API
 * answers `invalid-display-name` for one, and the screen refuses it before the
 * request goes out.
 * @param value - what the field holds.
 * @returns the value without zero-width characters, trimmed.
 */
export function sanitizeString(value: string): string {
  return value.replace(ZERO_WIDTH, '').trim()
}
