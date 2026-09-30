/**
 * The faces the shell waits for before it paints any text.
 *
 * Both families are single variable files, so loading one weight per family
 * covers every weight the application renders. The wait matters because the
 * preloader is drawn in a system font from inlined bytes: without it the first
 * screen paints in that fallback and reflows when the real face arrives, which
 * is exactly the flash the preloader exists to cover.
 * @module
 */

/** One weight per variable family, in the shorthand `document.fonts.load` parses. */
const FACES: readonly string[] = ['400 1em "Google Sans Flex"', '400 1em "Google Sans Code"']

/**
 * How long the shell waits before painting in whatever it has.
 *
 * A face that has not arrived by now is one the reader is better served
 * without: a blank page is worse than a reflow.
 */
const FONT_TIMEOUT_MS = 3000

/**
 * Wait for the application's own faces, or for the patience to run out.
 *
 * Never rejects: a browser that cannot report font state, or one whose fetch
 * fails, paints in the fallback rather than not at all.
 * @returns a promise that settles when the faces are usable or the wait expires.
 */
export async function fontsReady(): Promise<void> {
  const fonts = document.fonts as FontFaceSet | undefined
  // Older engines expose no font-loading API; there is nothing to wait for.
  if (fonts === undefined) return
  let timer: number | undefined
  const expiry = new Promise<void>((resolve) => {
    timer = window.setTimeout(resolve, FONT_TIMEOUT_MS)
  })
  try {
    await Promise.race([Promise.all(FACES.map(async face => fonts.load(face))), expiry])
  } catch {
    // A face that will not load is a fallback, not a boot failure.
  } finally {
    window.clearTimeout(timer)
  }
}
