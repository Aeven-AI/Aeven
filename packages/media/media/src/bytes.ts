/**
 * Byte labelling for the seam's {@link GeneratedMedia}. Providers return raw
 * bytes whose format their route does not reliably state — DeepInfra's
 * `response_format` names the encoding rather than the image format and answers
 * a PNG-defaulted request with JPEG, and OpenRouter reports `media_type` only
 * when it can identify the format — so the signature is the authority both
 * fall back to.
 * @module @aeven/media/bytes
 */

/**
 * The media type of one decoded image, read from its leading bytes.
 *
 * An unrecognized signature stays `application/octet-stream` rather than
 * guessing: a wrong concrete type makes a consumer render a broken image, while
 * the generic type makes it offer the bytes as a download.
 * @param data - the decoded image bytes.
 * @returns the sniffed IANA media type.
 */
export function imageMediaType(data: Uint8Array): string {
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return 'image/png'
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg'
  if (data[0] === 0x47 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x38) return 'image/gif'
  if (
    data[0] === 0x52 && data[1] === 0x49 && data[2] === 0x46 && data[3] === 0x46
    && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50
  ) return 'image/webp'
  return 'application/octet-stream'
}
