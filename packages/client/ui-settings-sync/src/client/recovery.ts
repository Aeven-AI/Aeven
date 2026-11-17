/** Saving and comparing recovery keys. */

/**
 * Hand the browser a text file holding the recovery key, which it saves to the user's downloads.
 * @param key - the recovery key.
 * @param heading - the file's first line, in the reader's language.
 */
export function saveRecoveryKey(key: string, heading: string): void {
  const url = URL.createObjectURL(new Blob([`${heading}\n\n${key}\n`], { type: 'text/plain;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'aeven-recovery-key.txt'
  link.click()
  URL.revokeObjectURL(url)
}

/**
 * A recovery key as the controller reads it: upper case, without spaces or dashes, with I, L and O read as 1, 1 and
 * 0 (Crockford's base32), so the confirmation accepts what the unlock would accept.
 * @param text - the key as written or typed.
 * @returns the comparable form.
 */
export function normalizeRecoveryKey(text: string): string {
  return text.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0')
}
