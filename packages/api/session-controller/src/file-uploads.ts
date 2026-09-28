/**
 * Authenticated file-attachment routes: `POST /api/attachment-upload` extracts,
 * stores, and stages one file; `DELETE /api/attachment-upload` discards an
 * unsent upload; `GET /api/attachment-file` serves a stored original the
 * addressed Session log cites. The connection service authenticates every
 * request before these handlers run.
 * @module @aeven/api-session-controller/file-uploads
 */

import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@aeven/attachment'
import type { StoredFileAttachment } from '@aeven/attachment'
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
  const headers: Record<string, string> = {
    ...BASE_HEADERS,
    'Content-Type': stored.ref.mediaType,
    'Content-Length': String(stored.data.byteLength),
    'Content-Disposition': `${url.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; ${dispositionName(stored.ref.name)}`,
  }
  return new Response(request.method === 'HEAD' ? null : stored.data.slice(), { headers })
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
