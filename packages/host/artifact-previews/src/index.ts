/**
 * Card pictures for the files Aeven made, served at `/api/artifact-preview?sessionId=…&path=…` for the Artifacts
 * page. Each file version is drawn once and kept on disk: the key is the file's identity, its filesystem freshness
 * token and size, and the picture settings, so a later request reads the cache. An address carrying `v`, the
 * version token the artifacts list reported, names one version: when it matches the file's current version the
 * answer may be kept by the browser for good, so a returning page asks for nothing; otherwise the browser
 * revalidates by ETag. Drawing waits for a free slot in a small queue.
 *
 * With `opening=1` the route answers a text or Markdown file's opening instead, under the same version rule, for
 * the card that sets it as text.
 *
 * A web page is screenshotted in a shared headless browser; a PDF's first page is drawn by pdf.js in a worker
 * thread; a picture is scaled down; an Office or iWork file shows the thumbnail it carries, else the PDF of the
 * same name beside it. Text and Markdown get no picture here: the card sets their opening itself. The file resolves through the
 * workspace file service under the same ownership and read rules as `/api/workspace-file`.
 * @module @aeven/host-artifact-previews
 */
import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/client-connection'
import type {} from '@aeven/api-workspace-files'
import type { FsInfo, FsTarget } from '@aeven/fs'
import { brandString } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import { BrowserUnavailableError, PreviewBrowser } from './browser.ts'
import { DrawingQueue, PreviewCache, previewKey, type CachedPreview } from './cache.ts'
import { needsAppServer, previewKind, siblingPdf, type PreviewKind } from './kinds.ts'
import { embeddedThumbnail } from './office.ts'
import { drawPdf } from './pdf.ts'

export { needsAppServer, previewKind, siblingPdf, type PreviewKind } from './kinds.ts'
export { embeddedThumbnail } from './office.ts'
export { PreviewCache, DrawingQueue, previewKey } from './cache.ts'

/** Cordis plugin name. */
export const name = 'artifact-previews'

/** The route answers HTTP and resolves files through the workspace file service. */
export const inject = ['connection', 'workspaceFiles', 'fs']

/** Bumped when a renderer changes what it draws, so every cached picture of that kind is drawn again. */
const RENDER_VERSION: Readonly<Record<PreviewKind, number>> = { image: 1, pdf: 1, office: 1, page: 2 }

/** Path of the route. */
const ROUTE = '/api/artifact-preview'

/** Deployment settings. */
export interface Config {
  /** Directory the pictures are cached in. */
  cacheDir: string
  /** Chromium executable for page previews; omitted, an installed Chrome, Chromium, Edge or Brave. */
  browserPath?: string
  /** Directory a headless shell is downloaded into when no browser is installed; omitted, nothing is downloaded. */
  browserCacheDir?: string
  /** Picture width in pixels. */
  width: number
  /** Picture height in pixels; the Artifacts cards are 4:5. */
  height: number
  /** WebP quality, 1 to 100. */
  quality: number
  /** Drawings that run at once. */
  concurrency: number
  /** Budget for drawing one picture, in milliseconds. */
  timeoutMs: number
  /** How long the headless browser stays open with no preview to draw, in milliseconds. */
  browserIdleMs: number
  /** The longest wait for a loaded page's network to go quiet before its screenshot, in milliseconds. */
  networkIdleMs: number
  /** How long a loaded page is given to finish drawing, such as a script-built scene, before its screenshot, in milliseconds. */
  settleMs: number
  /** Largest file read for a picture, in bytes; a larger file gets none. */
  maxSourceBytes: number
  /** Heap ceiling of the PDF worker, in megabytes. */
  maxWorkerHeapMb: number
  /** Characters of a text file's opening the route answers; the card shows fewer. */
  openingChars: number
  /**
   * A page screenshot whose colour channels all vary less than this, as a standard deviation over 0 to 255, is
   * blank, such as a page that drew nothing, and gets no picture.
   */
  blankStdev: number
}

export const Config: z<Config> = z.object({
  cacheDir: z.string().required(),
  browserPath: z.string(),
  browserCacheDir: z.string(),
  width: z.natural().min(64).default(480),
  height: z.natural().min(64).default(600),
  quality: z.natural().min(1).max(100).default(80),
  concurrency: z.natural().min(1).default(2),
  timeoutMs: z.natural().min(1000).default(15_000),
  browserIdleMs: z.natural().min(1000).default(60_000),
  networkIdleMs: z.natural().default(3000),
  settleMs: z.natural().default(800),
  maxSourceBytes: z.natural().min(1).default(64 * 1024 * 1024),
  maxWorkerHeapMb: z.natural().min(64).default(512),
  openingChars: z.natural().min(1).default(4000),
  blankStdev: z.number().min(0).max(255).default(3),
})

/** Headers of every response: the caller's own files, revalidated by ETag on each view. */
const HEADERS = { 'Cache-Control': 'private, no-cache', 'X-Content-Type-Options': 'nosniff' }

/** Cache policy of an answer whose address names the version it holds: it never changes. */
const KEPT = 'private, max-age=31536000, immutable'

/** Files whose opening the route answers as text. */
const TEXT_FILE = /\.(md|markdown|txt)$/iu

/**
 * The version token the artifacts list reports for a file, from the same stat fields.
 * @param info - the file's stat.
 * @returns the token.
 */
function versionToken(info: FsInfo): string {
  return `${String(info.version)}:${String(info.size ?? '')}`
}

/** A plain-text response. */
function plain(status: number, text: string): Response {
  return new Response(text, { status, headers: { ...HEADERS, 'Content-Type': 'text/plain; charset=utf-8' } })
}

/**
 * The answer for a file with no picture: absent, foreign, of a kind no renderer draws, or drawn as none. It is an
 * empty success rather than an error, because "no picture" is an ordinary outcome the card shows as paper, and a
 * browser logs every error status of an image it loads.
 * @param etag - the version's ETag, when known, so a browser revalidates instead of asking again.
 */
function noPicture(etag?: string): Response {
  return new Response(null, { status: 204, headers: etag === undefined ? HEADERS : { ...HEADERS, ETag: etag } })
}

/**
 * Register the preview route.
 * @param ctx - context carrying the connection, the workspace file service and the filesystem.
 * @param config - validated deployment settings.
 */
export function apply(ctx: Context, config: Config): void {
  const cache = new PreviewCache(config.cacheDir)
  const queue = new DrawingQueue(config.concurrency)
  const pdfLimits = { timeoutMs: config.timeoutMs, maxHeapMb: config.maxWorkerHeapMb }
  const browser = new PreviewBrowser(
    { browserPath: config.browserPath, browserCacheDir: config.browserCacheDir },
    config.browserIdleMs,
    { networkIdleMs: config.networkIdleMs, settleMs: config.settleMs },
  )
  ctx.effect(() => () => { void browser.close() }, 'artifact-previews: browser')
  const picture = { width: config.width, height: config.height, quality: config.quality }
  const logger = ctx.logger(name)

  /** Scale a picture to the card, keeping its top, where a page or slide begins. */
  const scaled = async (bytes: Uint8Array): Promise<Uint8Array> => {
    const { default: sharp } = await import('sharp')
    return new Uint8Array(await sharp(bytes).rotate().resize(config.width, config.height, { fit: 'cover', position: 'top' })
      .webp({ quality: config.quality }).toBuffer())
  }

  /** Whether a screenshot shows one flat colour: a page that drew nothing, or nothing yet. */
  const blank = async (image: Uint8Array): Promise<boolean> => {
    const { default: sharp } = await import('sharp')
    const { channels } = await sharp(image).stats()
    return channels.slice(0, 3).every(channel => channel.stdev < config.blankStdev)
  }

  const read = (target: FsTarget, signal: AbortSignal): Promise<Uint8Array> =>
    ctx.fs.readBytes(target, signal, config.maxSourceBytes)

  /** Draw one file's picture; `none` when the file has none. */
  const draw = async (
    kind: PreviewKind, sessionId: SessionId, path: string, target: FsTarget, signal: AbortSignal,
  ): Promise<CachedPreview> => {
    switch (kind) {
      case 'image':
        return await scaled(await read(target, signal))
      case 'pdf':
        return await drawPdf(await read(target, signal), picture, pdfLimits, signal)
      case 'office': {
        const thumbnail = embeddedThumbnail(await read(target, signal))
        if (thumbnail !== undefined) return await scaled(thumbnail)
        const pdf = await ctx.workspaceFiles.locateFile(sessionId, siblingPdf(path), signal, false)
        if (pdf === undefined || pdf.info.type !== 'file') return 'none'
        return await drawPdf(await read(pdf.target, signal), picture, pdfLimits, signal)
      }
      case 'page': {
        const html = new TextDecoder().decode(await read(target, signal))
        // An app's source page draws nothing without its server or build; its card is paper rather than a blank.
        if (needsAppServer(html)) return 'none'
        // A page on this machine's own disk opens from its file, so its stylesheets, scripts and images load.
        const local = isAbsolute(target.displayPath) && existsSync(target.displayPath)
        const shot = await browser.screenshot(local ? { kind: 'file', path: target.displayPath } : { kind: 'html', html }, picture, config.timeoutMs, signal)
        return await blank(shot) ? 'none' : shot
      }
      default: {
        const unknown: never = kind
        throw new Error(`artifact-previews: no renderer for ${String(unknown)}`)
      }
    }
  }

  /** The cached picture of a version, drawn once; a missing browser is not recorded against the file. */
  const pictureOf = (key: string, drawn: () => Promise<CachedPreview>): Promise<CachedPreview> => cache.get(key, async () => {
    try {
      return await queue.run(drawn)
    } catch (error) {
      if (error instanceof BrowserUnavailableError) throw error
      logger.debug('no preview: %s', error instanceof Error ? error.message : String(error))
      return 'none'
    }
  })

  /**
   * A text file's opening, read as a stream so only its start is decoded.
   * @returns the opening as plain text, under the version's cache policy.
   */
  const openingOf = async (target: FsTarget, info: FsInfo, cache: string, request: Request): Promise<Response> => {
    const etag = `"${previewKey(['opening', target.displayPath, versionToken(info), config.openingChars])}"`
    if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...HEADERS, 'Cache-Control': cache, ETag: etag } })
    let text = ''
    try {
      for await (const chunk of await ctx.fs.streamText(target, request.signal)) {
        text += chunk
        if (text.length >= config.openingChars) break
      }
    } catch {
      // A file that cannot be decoded as text, or vanished while read, has no opening to set.
      return noPicture()
    }
    const body = text.slice(0, config.openingChars)
    return new Response(request.method === 'HEAD' ? null : body, {
      status: 200,
      headers: { ...HEADERS, 'Cache-Control': cache, ETag: etag, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }

  ctx.effect(() => ctx.connection.fetch.register({
    path: ROUTE,
    methods: ['GET', 'HEAD'],
    fetch: async (request) => {
      const url = new URL(request.url)
      const sessionId = url.searchParams.get('sessionId')
      const path = url.searchParams.get('path')
      if (sessionId === null || sessionId === '' || path === null || path === '' || path.includes('\0')) {
        return plain(400, 'sessionId and path are required')
      }
      const opening = url.searchParams.get('opening') === '1'
      const kind = previewKind(path)
      if (opening ? !TEXT_FILE.test(path) : kind === undefined) return noPicture()
      const id = brandString<SessionId>(sessionId)
      let located: { target: FsTarget; info: FsInfo } | undefined
      try {
        // A picture never waits for a sync to bring the file: a file not here has no picture now.
        located = await ctx.workspaceFiles.locateFile(id, path, request.signal, false)
      } catch {
        // An absent or foreign Session and a refused path all read as absent, as on /api/workspace-file.
        return noPicture()
      }
      if (located === undefined || located.info.type !== 'file') return noPicture()
      const { target, info } = located
      // Kept by the browser for good only when the address names the version the file has now.
      const cache = url.searchParams.get('v') === versionToken(info) ? KEPT : HEADERS['Cache-Control']
      if (opening) return await openingOf(target, info, cache, request)
      if (kind === undefined || (info.size !== undefined && info.size > config.maxSourceBytes)) return noPicture()
      const key = previewKey([
        RENDER_VERSION[kind], kind, target.displayPath, String(info.version), info.size ?? -1, config.width, config.height, config.quality,
      ])
      const etag = `"${key}"`
      if (request.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers: { ...HEADERS, 'Cache-Control': cache, ETag: etag } })
      let image: CachedPreview
      try {
        // The drawing outlives the request that started it: a reader who scrolls away must not cancel the one
        // drawing every later view of this version reads, nor record its cancellation as "no picture".
        image = await pictureOf(key, () => draw(kind, id, path, target, AbortSignal.timeout(config.timeoutMs * 2)))
      } catch (error) {
        logger.debug('preview unavailable: %s', error instanceof Error ? error.message : String(error))
        return noPicture()
      }
      if (image === 'none') return noPicture(etag)
      return new Response(request.method === 'HEAD' ? null : image.slice(), {
        status: 200,
        headers: { ...HEADERS, 'Cache-Control': cache, ETag: etag, 'Content-Type': 'image/webp', 'Content-Length': String(image.byteLength) },
      })
    },
  }), 'artifact-previews: /api/artifact-preview')
}
