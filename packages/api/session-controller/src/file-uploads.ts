/**
 * Authenticated file-attachment routes: `POST /api/attachment-upload` extracts,
 * stores, and stages one file; `DELETE /api/attachment-upload` discards an
 * unsent upload; `GET /api/attachment-file` serves a stored original the
 * addressed Session log cites, and `GET /api/attachment-image` serves a stored
 * image the same way, under the name it was stored with or one derived from its
 * content digest. The connection service authenticates every request before
 * these handlers run.
 * @module @aeven/api-session-controller/file-uploads
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@aeven/attachment'
import type { AttachmentId, ImageAttachmentRef, ImageMediaType, StoredFileAttachment, StoredImageAttachment } from '@aeven/attachment'
import { brandString } from '@aeven/brand'
import type {} from '@aeven/client-connection'
import { DocumentExtractError } from '@aeven/document-extract'
import type { SessionId } from '@aeven/session'
import { ApiSessionNotFound } from './agent.ts'
import type { FileUploadFailure, FileUploadValue } from './types.ts'

/** Upload and discard route path. */
export const FILE_UPLOAD_PATH = '/api/attachment-upload'
/** Stored-original read route path. */
export const FILE_READ_PATH = '/api/attachment-file'
/** Stored-image read route path. */
export const IMAGE_READ_PATH = '/api/attachment-image'

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // Stored HTML and SVG originals may be opened directly on the authenticated API origin.
  'Content-Security-Policy': "sandbox; default-src 'none'",
}

function failure(status: number, code: string, message: string): Response {
  const body: FileUploadFailure = { code, message }
  return Response.json(body, { status, headers: BASE_HEADERS })
}

async function upload(ctx: Context, request: Request): Promise<Response> {
  const limits = ctx.attachments.fileLimits
  if (limits === undefined) return failure(501, 'FILES_UNSUPPORTED', 'This deployment does not accept file attachments.')
  const url = new URL(request.url)
  const name = (url.searchParams.get('name') ?? '').trim()
  const mediaType = (url.searchParams.get('type') ?? request.headers.get('content-type') ?? '')
    .split(';', 1)[0]?.trim().toLowerCase() ?? ''
  if (name === '') return failure(400, 'FILE_UNREADABLE', 'A file name is required.')
  const declared = Number(request.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > limits.maxFileBytes) {
    return failure(413, 'FILE_TOO_LARGE', 'File exceeds the configured byte limit.')
  }
  if (!ctx.documentExtract.accepts(name, mediaType)) {
    return failure(415, 'UNSUPPORTED_FILE_TYPE', `Files of this type cannot be read: ${name}`)
  }
  const data = new Uint8Array(await request.arrayBuffer())
  if (data.byteLength === 0) return failure(400, 'FILE_EMPTY', 'File is empty.')
  if (data.byteLength > limits.maxFileBytes) return failure(413, 'FILE_TOO_LARGE', 'File exceeds the configured byte limit.')
  let extracted
  try {
    extracted = await ctx.documentExtract.extract({ data, name, mediaType }, request.signal)
  } catch (error) {
    if (request.signal.aborted) return failure(499, 'CANCELLED', 'Upload cancelled.')
    if (error instanceof DocumentExtractError && error.code === 'UNSUPPORTED_FORMAT') {
      return failure(415, 'UNSUPPORTED_FILE_TYPE', error.message)
    }
    ctx.logger.warn(`attachment-upload: extraction failed for ${JSON.stringify(name)}: ${String(error)}`)
    return failure(422, 'FILE_UNREADABLE', 'The file could not be read.')
  }
  try {
    const ref = await ctx.attachments.saveFile({
      data,
      mediaType,
      name,
      text: {
        text: extracted.text,
        method: extracted.method,
        extractor: extracted.extractor,
        truncated: extracted.truncated,
        ...extracted.pages === undefined ? {} : { pages: extracted.pages },
      },
    })
    const value: FileUploadValue = {
      uploadId: String(ctx.attachments.stageUpload(ref)),
      name: ref.name,
      mediaType: ref.mediaType,
      bytes: ref.bytes,
      chars: ref.extraction.chars,
      truncated: ref.extraction.truncated,
      ...ref.extraction.pages === undefined ? {} : { pages: ref.extraction.pages },
    }
    return Response.json(value, { status: 201, headers: BASE_HEADERS })
  } catch (error) {
    if (error instanceof AttachmentError) return failure(error.code === 'FILE_TOO_LARGE' ? 413 : 400, error.code, error.message)
    throw error
  }
}

function discard(ctx: Context, request: Request): Response {
  const id = new URL(request.url).searchParams.get('id')
  if (id === null || id === '') return failure(400, 'FILE_UPLOAD_UNKNOWN', 'An upload id is required.')
  ctx.attachments.discardUpload(id)
  return new Response(null, { status: 204, headers: BASE_HEADERS })
}

/**
 * The name a stored image is served under when it carries none: the first bytes
 * of its content digest and the extension its media type names, which is the
 * same name the conversation shows for the reference.
 * @param attachmentId - the stored reference's `sha256:<digest>` id.
 * @param mediaType - the stored media type, which picks the extension.
 * @returns the file name to serve.
 */
function derivedImageName(attachmentId: string, mediaType: string): string {
  const digest = attachmentId.replace(/^sha256:/, '').slice(0, 12)
  const extension = mediaType === 'image/jpeg' ? 'jpg' : (mediaType.split('/')[1] ?? 'img')
  return `${digest}.${extension}`
}

/** A stored image id: the content digest the reference is addressed by. */
const IMAGE_ID = /^sha256:[0-9a-f]{64}$/
/** Media types a stored image reference may declare. */
const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const

/**
 * The image reference a request names directly, or undefined when the request
 * does not carry every fact a reference holds. The values are declarations: the
 * attachment store verifies each of them against the stored bytes before it
 * answers, so a request cannot describe an image it does not hold.
 * @param url - the request's URL, carrying `id`, `type`, `bytes`, `width`, `height`.
 * @returns the reference to read, or undefined when a fact is missing or malformed.
 */
function directImageRef(url: URL): ImageAttachmentRef | undefined {
  const id = url.searchParams.get('id') ?? ''
  const mediaType = url.searchParams.get('type') ?? ''
  const bytes = Number(url.searchParams.get('bytes') ?? Number.NaN)
  const width = Number(url.searchParams.get('width') ?? Number.NaN)
  const height = Number(url.searchParams.get('height') ?? Number.NaN)
  if (!IMAGE_ID.test(id)) return undefined
  if (!(IMAGE_TYPES as readonly string[]).includes(mediaType)) return undefined
  if (![bytes, width, height].every(value => Number.isInteger(value) && value > 0)) return undefined
  const name = url.searchParams.get('name') ?? undefined
  return {
    attachmentId: brandString<AttachmentId>(id),
    mediaType: mediaType as ImageMediaType,
    bytes,
    width,
    height,
    ...name === undefined || name === '' ? {} : { name },
  }
}

/** One stored original's bytes, under the name it is served with. */
interface StoredOriginal {
  mediaType: string
  name: string
  data: Uint8Array
  /**
   * Cache directive to send instead of the default `no-store`. A content-
   * addressed read names immutable bytes, so it may be cached privately.
   */
  cache?: string | undefined
}

/**
 * Answer one stored original: its type, its length, and the name a browser
 * saves it under, inline for viewing and as an attachment when the caller asks
 * for a download. A `HEAD` request carries the headers with no body.
 * @param stored - the bytes and the name to serve them under.
 * @param request - the request being answered, for its method and `download`.
 * @returns the response the route returns.
 */
function storedOriginal(stored: StoredOriginal, request: Request): Response {
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    ...stored.cache === undefined ? {} : { 'Cache-Control': stored.cache },
    'Content-Type': stored.mediaType,
    'Content-Length': String(stored.data.byteLength),
    'Content-Disposition': `${new URL(request.url).searchParams.get('download') === '1' ? 'attachment' : 'inline'}; ${dispositionName(stored.name)}`,
  }
  return new Response(request.method === 'HEAD' ? null : stored.data.slice(), { headers })
}

/** Quote one display name for `Content-Disposition`. */
function dispositionName(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  return `filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

async function read(
  request: Request,
  readReferenced: (sessionId: SessionId, attachmentId: string) => Promise<StoredFileAttachment | undefined>,
): Promise<Response> {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  const attachmentId = url.searchParams.get('id')
  if (sessionId === null || sessionId === '' || attachmentId === null || attachmentId === '') {
    return failure(400, 'INVALID_ATTACHMENT_REF', 'sessionId and id are required.')
  }
  let stored: StoredFileAttachment | undefined
  try {
    stored = await readReferenced(brandString<SessionId>(sessionId), attachmentId)
  } catch (error) {
    if (error instanceof ApiSessionNotFound) return failure(404, 'SESSION_NOT_FOUND', error.message)
    if (error instanceof AttachmentError) return failure(error.code === 'ATTACHMENT_NOT_FOUND' ? 404 : 500, error.code, error.message)
    throw error
  }
  if (stored === undefined) return failure(404, 'ATTACHMENT_NOT_REFERENCED', 'File is not referenced by this session.')
  return storedOriginal({ mediaType: stored.ref.mediaType, name: stored.ref.name, data: stored.data }, request)
}

/**
 * Answer the stored image one session log cites.
 *
 * The image is served under the name its reference carries, or — for the images
 * stored before references were named — under a name derived from its content
 * digest, so a browser never saves it as an unnamed file.
 * @param request - the `GET`/`HEAD` request naming the session and the image.
 * @param readReferenced - Session-authorized reader of one cited image.
 * @returns the image bytes with their type, length, and served name.
 */
async function readImage(
  request: Request,
  readReferenced: (sessionId: SessionId, attachmentId: string) => Promise<StoredImageAttachment | undefined>,
  readDirect: (ref: ImageAttachmentRef) => Promise<StoredImageAttachment>,
): Promise<Response> {
  const url = new URL(request.url)
  const sessionId = url.searchParams.get('sessionId')
  const attachmentId = url.searchParams.get('id')
  if (attachmentId === null || attachmentId === '') {
    return failure(400, 'INVALID_ATTACHMENT_REF', 'id is required.')
  }
  // A named session authorizes the read from its own log. A request that names
  // no session reads the stored object by the reference it describes — the same
  // authenticated-client access the path-addressed file route already grants,
  // narrowed to content-addressed images whose reference the store verifies.
  const ref = sessionId === null || sessionId === '' ? directImageRef(url) : undefined
  if (sessionId === null || sessionId === '') {
    if (ref === undefined) {
      return failure(400, 'INVALID_ATTACHMENT_REF', 'id, type, bytes, width and height are required.')
    }
  }
  let stored: StoredImageAttachment | undefined
  try {
    stored = ref === undefined
      ? await readReferenced(brandString<SessionId>(sessionId ?? ''), attachmentId)
      : await readDirect(ref)
  } catch (error) {
    if (error instanceof ApiSessionNotFound) return failure(404, 'SESSION_NOT_FOUND', error.message)
    if (error instanceof AttachmentError) return failure(error.code === 'ATTACHMENT_NOT_FOUND' ? 404 : 500, error.code, error.message)
    throw error
  }
  if (stored === undefined) return failure(404, 'ATTACHMENT_NOT_REFERENCED', 'Image is not referenced by this session.')
  const name = stored.ref.name ?? derivedImageName(String(stored.ref.attachmentId), stored.ref.mediaType)
  const cache = ref === undefined ? undefined : 'private, max-age=31536000, immutable'
  return storedOriginal({ mediaType: stored.ref.mediaType, name, data: stored.data, cache }, request)
}

/**
 * Register the upload and discard route.
 * @param ctx - context carrying connection, attachments, and document extraction.
 */
export function registerFileUploadRoutes(ctx: Context): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: FILE_UPLOAD_PATH,
    methods: ['POST', 'DELETE'],
    fetch: request => request.method === 'DELETE' ? Promise.resolve(discard(ctx, request)) : upload(ctx, request),
  }), 'session-controller: /api/attachment-upload')
}

/**
 * Register the stored-image read route.
 * @param ctx - context carrying the connection service.
 * @param readReferenced - Session-authorized reader of one cited image.
 * @param readDirect - reader of one image the request describes by reference.
 */
export function registerImageReadRoute(
  ctx: Context,
  readReferenced: (sessionId: SessionId, attachmentId: string) => Promise<StoredImageAttachment | undefined>,
  readDirect: (ref: ImageAttachmentRef) => Promise<StoredImageAttachment>,
): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: IMAGE_READ_PATH,
    methods: ['GET', 'HEAD'],
    fetch: request => readImage(request, readReferenced, readDirect),
  }), 'session-controller: /api/attachment-image')
}

/**
 * Register the stored-original read route.
 * @param ctx - context carrying the connection service.
 * @param readReferenced - Session-authorized reader of one cited original.
 */
export function registerFileReadRoute(
  ctx: Context,
  readReferenced: (sessionId: SessionId, attachmentId: string) => Promise<StoredFileAttachment | undefined>,
): void {
  ctx.effect(() => ctx.connection.fetch.register({
    path: FILE_READ_PATH,
    methods: ['GET', 'HEAD'],
    fetch: request => read(request, readReferenced),
  }), 'session-controller: /api/attachment-file')
}
