/** SVG attachments: a file the trays present as a picture. */

/** Media type of an SVG original. */
const SVG_MEDIA_TYPE = 'image/svg+xml'

/**
 * Whether one attachment's bytes are a picture a browser renders even though
 * the harness keeps them in the file path: `image/svg+xml` never enters the
 * raster image path, so the tray would otherwise show a file tile for it. The
 * media type decides first, and the name covers an upload whose browser
 * declared none.
 * @param name - display name including its extension, or undefined when the source carries none.
 * @param mediaType - browser-declared or stored media type, possibly empty.
 * @returns true when the attachment is an SVG.
 */
export function isSvgAttachment(name: string | undefined, mediaType: string | undefined): boolean {
  const declared = mediaType ?? ''
  const parameters = declared.indexOf(';')
  const type = (parameters === -1 ? declared : declared.slice(0, parameters)).trim().toLowerCase()
  if (type === SVG_MEDIA_TYPE) return true
  return (name ?? '').toLowerCase().endsWith('.svg')
}
