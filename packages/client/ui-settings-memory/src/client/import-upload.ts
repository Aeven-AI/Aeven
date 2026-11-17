/**
 * Upload of a file to import into memory, through the same Host route a composer attachment uses. An archive is
 * first rebuilt in the browser from its text files alone: exports carry images, audio, and an HTML copy of every
 * conversation, which can make them gigabytes, while the conversations themselves are a small part.
 */
import { Unzip, UnzipInflate, zip, zipSync, type Zippable } from 'fflate'

/** Archive files kept for the import: text formats the agent can read with its own scripts. */
const TEXT_FILE = /\.(json|jsonl|ndjson|md|markdown|txt|csv|html?)$/i
/** ChatGPT's `chat.html` repeats `conversations.json` as one very large page. */
const REPEATED_FILE = /(^|\/)chat\.html$/i

/** Host route that stores and stages one attachment. */
const UPLOAD_ROUTE = 'api/attachment-upload'

/** A failed upload, with the Host's failure code when it gave one. */
export class ImportUploadError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
  }
}

/** Step the upload is in, for the page to show. */
export type ImportUploadStage = 'preparing' | 'uploading'

function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0))
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

/**
 * Rebuild an archive from its text files, streaming it so a large export is never held whole.
 * @param file - the chosen `.zip`.
 * @returns a smaller `.zip` with the same name and the same text files.
 * @throws {ImportUploadError} `NO_TEXT` when the archive holds no text file.
 */
async function slimArchive(file: File): Promise<File> {
  const kept: Zippable = {}
  const unzipper = new Unzip((entry) => {
    if (!TEXT_FILE.test(entry.name) || REPEATED_FILE.test(entry.name)) return
    const chunks: Uint8Array[] = []
    entry.ondata = (error, data, final) => {
      if (error) throw error
      chunks.push(data)
      if (final) kept[entry.name] = concat(chunks)
    }
    entry.start()
  })
  unzipper.register(UnzipInflate)
  const reader = file.stream().getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    unzipper.push(value)
  }
  unzipper.push(new Uint8Array(0), true)
  if (Object.keys(kept).length === 0) throw new ImportUploadError('NO_TEXT', 'The archive holds no text files.')
  const bytes = await new Promise<Uint8Array>((resolve) => {
    // Compression runs in fflate's workers; a page whose policy refuses them compresses on this thread instead.
    zip(kept, { level: 6 }, (error, out) => { resolve(error ? zipSync(kept, { level: 6 }) : out) })
  })
  return new File([bytes as BlobPart], file.name, { type: 'application/zip' })
}

/** The page's authenticated Host transport, absent when the page installed none. */
interface PageTransport {
  fetch(input: URL, init: RequestInit): Promise<Response>
}

/** Send through the page's authenticated Host transport, as the page's RPC calls do. */
function hostFetch(input: URL, init: RequestInit): Promise<Response> {
  const transport = (globalThis as { __AVN_TRANSPORT__?: PageTransport }).__AVN_TRANSPORT__
  if (transport !== undefined) return transport.fetch(input, init)
  return globalThis.fetch(input, init)
}

/**
 * Upload one file as a conversation attachment.
 * @param file - an exported archive (`.zip`) or one saved conversation.
 * @param onStage - told when the upload moves from preparing the archive to sending it.
 * @returns the upload id a prompt's file part names.
 * @throws {ImportUploadError} with the Host's failure code (such as `FILE_TOO_LARGE`), or `UPLOAD_FAILED`.
 */
export async function uploadImport(file: File, onStage: (stage: ImportUploadStage) => void): Promise<string> {
  let body = file
  if (/\.zip$/i.test(file.name)) {
    onStage('preparing')
    try {
      body = await slimArchive(file)
    } catch (error) {
      if (error instanceof ImportUploadError) throw error
      throw new ImportUploadError('FILE_UNREADABLE', error instanceof Error ? error.message : String(error))
    }
  }
  onStage('uploading')
  const type = body.type || 'application/octet-stream'
  const url = new URL(UPLOAD_ROUTE, document.baseURI)
  url.searchParams.set('name', body.name)
  url.searchParams.set('type', type)
  let response: Response
  try {
    response = await hostFetch(url, { method: 'POST', headers: { 'Content-Type': type }, body })
  } catch (error) {
    throw new ImportUploadError('UPLOAD_FAILED', error instanceof Error ? error.message : String(error))
  }
  const payload = await response.json().catch(() => undefined) as { uploadId?: string; code?: string; message?: string } | undefined
  if (response.status !== 201 || typeof payload?.uploadId !== 'string') {
    throw new ImportUploadError(payload?.code ?? 'UPLOAD_FAILED', payload?.message ?? `HTTP ${response.status}`)
  }
  return payload.uploadId
}
