/**
 * Unlocking synced data in the same passkey prompt that signs the reader in.
 *
 * Before the passkey sign-in page opens, this page draws a one-use X25519 key pair and a verifier and hands the
 * page `#key=…&vault=…&salt=…`. The page evaluates the passkey's PRF with `salt` in the sign-in prompt, seals the
 * result to `key`, and deposits it on the Aeven site under `vault`, the verifier's SHA-256. The pair and the verifier
 * wait in session storage, which survives a sign-in that leaves this document and returns to it, until the sync
 * plugin takes them from the published reader and its Host collects the result; a result the site no longer keeps
 * is simply not found. The fragment never reaches a server.
 * @module
 */

/** Session-storage key holding the pending unlock. */
const STORAGE_KEY = 'aeven:passkey-unlock'

/**
 * The input every passkey PRF evaluation for account sync hashes to; equal to `PASSKEY_PRF_SALT` of
 * `@aeven/sync-vault`, so any passkey yields the same output whichever page asks.
 */
const PRF_SALT_INPUT = 'aeven-sync/passkey/prf'

/** What the sync plugin hands its Host to collect the sign-in's unlock result. */
export interface PasskeyUnlock {
  /** The secret whose SHA-256 the result is stored under, base64url. */
  readonly verifier: string
  /** The raw X25519 public key the result is sealed to, base64url. */
  readonly publicKey: string
  /** The raw X25519 private key that opens it, base64url. */
  readonly secretKey: string
}

/**
 * Encode bytes as unpadded base64url.
 * @param bytes - the bytes to encode.
 * @returns the encoded text.
 */
function base64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/**
 * The SHA-256 of a text, base64url.
 * @param text - the text to hash.
 * @returns the digest.
 */
async function sha256(text: string): Promise<string> {
  return base64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))
}

/**
 * Draw the key pair and verifier for one passkey sign-in and keep them for the sync plugin.
 * @returns the fragment parameters for the sign-in page, or undefined when this browser cannot draw an X25519 key
 *   or keep it, so the sign-in runs without unlocking.
 */
export async function preparePasskeyUnlock(): Promise<string | undefined> {
  try {
    const pair = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveBits'])
    const publicKey = base64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)))
    const secretKey = (await crypto.subtle.exportKey('jwk', pair.privateKey)).d
    if (secretKey === undefined) return undefined
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(32)))
    const stored: PasskeyUnlock = { verifier, publicKey, secretKey }
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stored))
    return new URLSearchParams({ key: publicKey, vault: await sha256(verifier), salt: await sha256(PRF_SALT_INPUT) }).toString()
  } catch {
    // A browser without X25519 in Web Crypto, or with session storage blocked, signs in without the unlock; the
    // sync plugin then asks for the passkey on its own.
    return undefined
  }
}

/**
 * Take the pending unlock, once.
 * @returns the unlock, or undefined when none is pending.
 */
export function takePasskeyUnlock(): PasskeyUnlock | undefined {
  let raw: string | null
  try {
    raw = window.sessionStorage.getItem(STORAGE_KEY)
    window.sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // Blocked session storage held nothing for this page to take.
    return undefined
  }
  if (raw === null) return undefined
  try {
    const stored = JSON.parse(raw) as Partial<PasskeyUnlock>
    if (typeof stored.verifier !== 'string' || typeof stored.publicKey !== 'string' || typeof stored.secretKey !== 'string') return undefined
    return { verifier: stored.verifier, publicKey: stored.publicKey, secretKey: stored.secretKey }
  } catch {
    // Unparseable storage is an unlock this page cannot use; the sync plugin asks for the passkey instead.
    return undefined
  }
}
