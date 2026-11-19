/**
 * URL validation, content-type classification, and charset resolution for the
 * local HTTP(S) fetch provider — the pure, network-free half. The provider's
 * `fetch()` composes these with transport (redirect following, byte caps,
 * decoding).
 *
 * @module @aeven/web-fetch-http/policy
 */

import { WebError } from '@aeven/web'

/** Maximum accepted request URL length enforced by the public fetch provider. */
export const WEB_FETCH_MAX_URL_LENGTH = 2048

/** The body kinds this provider returns. */
export type FetchableKind = 'html' | 'text' | 'document'

/**
 * Binary document media types returned whole as a `document` body for the consumer to
 * convert. `application/octet-stream` is included because file servers often label PDFs
 * that way; the consumer then identifies the format by file name.
 */
const DOCUMENT_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/x-pdf',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/rtf',
  'application/epub+zip',
  'application/octet-stream',
])

/**
 * Parse a request URL and enforce network-independent transport restrictions:
 * HTTP(S) only and no embedded credentials. The provider applies this before
 * resolving a destination.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function parseFetchUrl(input: string): URL {
  let url: URL
  try {
    url = new URL(input)
  } catch (error: unknown) {
    throw new WebError(`invalid URL: ${input}`, 'WEB_INVALID_URL', { cause: error })
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new WebError(`unsupported URL scheme "${url.protocol}" (only http and https are allowed)`, 'WEB_INVALID_URL')
  }
  if (url.username.length > 0 || url.password.length > 0) {
    throw new WebError('credentials in URLs are not allowed', 'WEB_BLOCKED_URL')
  }
  return url
}

/**
 * Validate a request URL against the provider's complete pre-network policy:
 * bounded length plus the restrictions enforced by {@link parseFetchUrl}.
 * Public-address resolution and connection pinning run after this check.
 *
 * @param input - the raw URL string from the fetch request.
 * @returns the parsed `URL`.
 */
export function validateFetchUrl(input: string): URL {
  if (input.length > WEB_FETCH_MAX_URL_LENGTH) {
    throw new WebError(`URL exceeds the maximum length of ${WEB_FETCH_MAX_URL_LENGTH}`, 'WEB_INVALID_URL')
  }
  return parseFetchUrl(input)
}

/**
 * Two URLs are same-origin when scheme, hostname, and port match. A redirect
 * that crosses origins is refused so each new origin requires a fresh tool call
 * and public-address validation.
 *
 * @param a - one of the two URLs to compare.
 * @param b - the other URL to compare.
 * @returns true when `a` and `b` share scheme, hostname, and port.
 */
export function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.hostname === b.hostname && a.port === b.port
}

/**
 * Classify a response `Content-Type` into a body kind, or `undefined` for an
 * unsupported type. `text/html` and `application/xhtml+xml` are `html`; other
 * `text/*` plus a few structured text types are `text`; PDF, Office,
 * OpenDocument, RTF, EPUB, and `application/octet-stream` are `document`.
 *
 * @param contentType - the raw `Content-Type` header, or `null` when the
 *   response carries none (unsupported).
 * @returns the body kind, or `undefined` for an unsupported type.
 */
export function classifyContentType(contentType: string | null): FetchableKind | undefined {
  const mime = mediaTypeOf(contentType)
  if (mime === 'text/html' || mime === 'application/xhtml+xml') return 'html'
  if (mime === 'text/rtf') return 'document'
  if (mime.startsWith('text/')) return 'text'
  if (mime === 'application/json' || mime === 'application/xml' || mime.endsWith('+json') || mime.endsWith('+xml')) return 'text'
  if (DOCUMENT_MEDIA_TYPES.has(mime)) return 'document'
  return undefined
}

/**
 * The lower-cased media type of a `Content-Type` header without parameters.
 *
 * @param contentType - the raw header, or `null` when absent.
 * @returns the bare media type, empty when absent.
 */
export function mediaTypeOf(contentType: string | null): string {
  return (contentType ?? '').replace(/;.*$/s, '').trim().toLowerCase()
}

/**
 * The file name a document response names: the `Content-Disposition` `filename*` or
 * `filename` parameter, else the URL's last non-empty path segment. Path separators
 * are stripped so the name never carries directory information.
 *
 * @param disposition - the raw `Content-Disposition` header, or `null` when absent.
 * @param url - the final response URL.
 * @returns the file name, possibly empty.
 */
export function documentFileName(disposition: string | null, url: URL): string {
  const extended = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(disposition ?? '')?.[1]
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(disposition ?? '')
  let name = extended === undefined ? (plain?.[1] ?? plain?.[2] ?? '') : safeDecode(extended.trim())
  if (name.trim() === '') name = safeDecode(url.pathname.split('/').findLast(segment => segment !== '') ?? '')
  return name.trim().split(/[\\/]/).at(-1) ?? ''
}

/** Percent-decode a name, keeping the raw text when it is not valid percent-encoding. */
function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch (_error: unknown) {
    // A malformed escape leaves the server's literal name, which is still a usable label.
    return value
  }
}

/**
 * Extract the lower-cased `charset` parameter from a response `Content-Type`.
 *
 * @param contentType - the raw header, or `null` when absent.
 * @returns the charset parameter, or `undefined` when none is declared.
 */
export function parseCharset(contentType: string | null): string | undefined {
  const match = /;\s*charset\s*=\s*"?([^";]+)"?/i.exec(contentType ?? '')
  return match?.[1]?.trim().toLowerCase()
}

/**
 * Resolve the declared charset, defaulting to UTF-8 when absent. A malformed
 * comma- or whitespace-joined declaration containing a UTF-8 label uses a fatal
 * UTF-8 decoder; other unsupported declarations throw `WEB_UNSUPPORTED_CONTENT_TYPE`.
 * UTF-8 recovery is a preference, not proof of the original encoding.
 *
 * @param charset - the declared charset parameter, or `undefined` to default.
 * @returns a decoder; callers must report fatal decoding failures and flush at
 *   EOF unless they deliberately truncated the bytes.
 */
export function decoderForCharset(charset: string | undefined): TextDecoder {
  const declared = charset ?? 'utf-8'
  try {
    return new TextDecoder(declared)
  } catch (error: unknown) {
    if (declared.split(/[\s,]+/).some(isUtf8Label)) return new TextDecoder('utf-8', { fatal: true })
    throw new WebError(`unsupported charset "${declared}"`, 'WEB_UNSUPPORTED_CONTENT_TYPE', { cause: error })
  }
}

/** Whether a label names UTF-8, including its standard aliases. */
function isUtf8Label(label: string): boolean {
  try {
    return new TextDecoder(label).encoding === 'utf-8'
  } catch (_error: unknown) {
    // An unsupported label does not authorize UTF-8 recovery.
    return false
  }
}
