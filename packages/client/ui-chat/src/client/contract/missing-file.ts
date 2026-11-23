/**
 * The refusal the chat view's opener raises when nothing exists at a path on the Host, which the file-open dialog
 * words for the reader instead of showing the opener's own text.
 * @module
 */

/** Nothing exists at the path on this Host, such as a file another device of the account wrote. */
export class MissingFileError extends Error {
  /**
   * @param path - the absolute Host path the opener looked for.
   */
  constructor(readonly path: string) {
    super(`no file at ${path} on this device`)
    this.name = 'MissingFileError'
  }
}
