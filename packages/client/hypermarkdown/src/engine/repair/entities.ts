import { patterns } from '../patterns.ts'

/**
 * Drop a character reference that is still arriving.
 *
 * "&copy;" is a symbol only once its semicolon lands; until then the buffer
 * ends in a partial reference such as "&cop", which would flash at the reader
 * as a literal ampersand followed by letters. Removing it costs nothing,
 * because the whole reference returns in the next chunk.
 *
 * @param text - the block text to strip a trailing partial entity from.
 * @param pending - whether the block is still being streamed, so a reference
 *   really can be cut off mid-flight; a closed block is returned unchanged.
 * @returns the text without its partial entity, or the text itself when there
 *   is nothing pending and no partial reference to drop.
 */
export function fixPartialEntity(text: string, pending: boolean): string {
  if (!text || text === '' || ! pending) {
    return text
  }

  return text.replace(patterns.partialEntityRegex, '')
}
