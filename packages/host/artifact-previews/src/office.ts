/**
 * The thumbnail an Office or iWork file carries inside its zip container: Keynote, Pages and Numbers keep a
 * full-size `preview.jpg`; Word, PowerPoint and Excel keep `docProps/thumbnail.*` when the saving app wrote one.
 * @module @aeven/host-artifact-previews/office
 */
import { unzipSync } from 'fflate'

/** Entries that hold a thumbnail, best first. */
const THUMBNAIL_ENTRIES = [
  'preview.jpg', 'QuickLook/Thumbnail.jpg', 'preview-web.jpg', 'preview-micro.jpg',
  'docProps/thumbnail.jpeg', 'docProps/thumbnail.jpg', 'docProps/thumbnail.png',
] as const

/**
 * Read the thumbnail a zip container carries.
 * @param bytes - the file's bytes.
 * @returns the thumbnail's bytes, or undefined when the file is not a zip or carries none.
 */
export function embeddedThumbnail(bytes: Uint8Array): Uint8Array | undefined {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes, { filter: entry => (THUMBNAIL_ENTRIES as readonly string[]).includes(entry.name) })
  } catch {
    // Not a zip container, such as a Keynote file saved as a package folder: the file carries no thumbnail here.
    return undefined
  }
  for (const name of THUMBNAIL_ENTRIES) {
    const entry = entries[name]
    if (entry !== undefined && entry.byteLength > 0) return entry
  }
  return undefined
}
