/**
 * Browser routes behind the Motion card on a Host that renders motion films: the live preview bundle of a
 * composition folder, the user's export of that folder to an MP4, and the exported film's bytes. Every route
 * sits behind the connection service's authentication; like `/api/file`, a path names any local folder or
 * file the authenticated account may read.
 * @module @aeven/api-motion
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/client-connection'
import type { MotionQuality } from '@aeven/motion'
import type {} from '@aeven/motion'

export const name = 'api-motion'
export const inject = ['connection', 'motion']

/** Route configuration. */
export interface Config {
  /** Quality of a film the user exports from the card. */
  exportQuality: MotionQuality
}

export const Config: z<Config> = z.object({
  exportQuality: z.union(['draft', 'standard', 'high'] as const).default('high'),
})

/** Exported film facts the card reads. */
export interface MotionExportResponse {
  readonly path: string
  readonly bytes: number
  readonly durationSeconds: number
  readonly width: number
  readonly height: number
}

const BASE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'X-Content-Type-Options': 'nosniff',
  // Opened directly on the authenticated API origin, a response runs nothing.
  'Content-Security-Policy': "sandbox; default-src 'none'",
}

/**
 * A response carrying a plain-text or JSON body with the base headers.
 * @param status - HTTP status.
 * @param body - text, or a value sent as JSON.
 * @returns the response.
 */
function reply(status: number, body: string | object): Response {
  const json = typeof body !== 'string'
  return new Response(json ? JSON.stringify(body) : body, {
    status,
    headers: { ...BASE_HEADERS, 'Content-Type': json ? 'application/json' : 'text/plain; charset=utf-8' },
  })
}

/**
 * The composition folder a request names: absolute, and holding an `index.html`.
 * @param dir - the `dir` value the request carried.
 * @returns the folder, or an error response.
 */
async function compositionFolder(dir: unknown): Promise<string | Response> {
  if (typeof dir !== 'string' || dir.length === 0 || dir.includes('\0') || !isAbsolute(dir)) return reply(400, 'absolute dir required')
  const index = await stat(join(dir, 'index.html')).catch(() => undefined)
  if (index?.isFile() !== true) return reply(404, 'no index.html in dir')
  return dir
}

/**
 * Serve a film's bytes, honouring one `Range: bytes=` span so the card can seek.
 * @param request - the GET or HEAD request.
 * @param path - absolute `.mp4` path.
 * @returns the full or partial response.
 */
async function serveFilm(request: Request, path: string): Promise<Response> {
  const info = await stat(path).catch(() => undefined)
  if (info?.isFile() !== true) return reply(404, 'not found')
  const headers: Record<string, string> = { ...BASE_HEADERS, 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes' }
  const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '')
  let start = 0
  let end = info.size - 1
  if (range !== null && (range[1] !== '' || range[2] !== '')) {
    if (range[1] === '') start = Math.max(0, info.size - Number(range[2]))
    else {
      start = Number(range[1])
      if (range[2] !== '') end = Math.min(end, Number(range[2]))
    }
    if (start > end || start >= info.size) return new Response(null, { status: 416, headers: { ...BASE_HEADERS, 'Content-Range': `bytes */${String(info.size)}` } })
    headers['Content-Range'] = `bytes ${String(start)}-${String(end)}/${String(info.size)}`
  }
  headers['Content-Length'] = String(end - start + 1)
  const status = headers['Content-Range'] === undefined ? 200 : 206
  if (request.method === 'HEAD') return new Response(null, { status, headers })
  const stream = createReadStream(path, { start, end })
  request.signal.addEventListener('abort', () => { stream.destroy() }, { once: true })
  return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status, headers })
}

/**
 * Register the preview, export, and film routes.
 * @param ctx - context carrying the connection service and the motion renderer.
 * @param config - export quality.
 */
export function apply(ctx: Context, config: Config): void {
  // The live preview: the folder bundled into one document, its scene files, runtime, images, and fonts
  // inlined, because the player loads it as `srcdoc` in an opaque-origin frame that resolves no relative URL.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/motion/preview',
    methods: ['GET'],
    fetch: async (request) => {
      const dir = await compositionFolder(new URL(request.url).searchParams.get('dir'))
      if (dir instanceof Response) return dir
      try {
        return reply(200, await ctx.motion.bundle(dir))
      } catch (error) {
        return reply(422, error instanceof Error ? error.message : String(error))
      }
    },
  }), 'api-motion: /api/motion/preview')

  // The user's export: one render at the configured quality into `renders/<folder>.mp4`.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/motion/export',
    methods: ['POST'],
    fetch: async (request) => {
      let body: { dir?: unknown }
      try {
        body = await request.json() as { dir?: unknown }
      } catch {
        // A body that is not JSON names no folder; the folder check below answers it.
        body = {}
      }
      const dir = await compositionFolder(body.dir)
      if (dir instanceof Response) return dir
      try {
        const spec = ctx.motion.resolve({
          compositionDir: dir,
          outputPath: join(dir, 'renders', `${basename(dir)}.mp4`),
          quality: config.exportQuality,
        })
        const film = await ctx.motion.render(spec, request.signal)
        const response: MotionExportResponse = {
          path: film.outputPath,
          bytes: film.bytes,
          durationSeconds: film.durationSeconds,
          width: film.width,
          height: film.height,
        }
        return reply(200, response)
      } catch (error) {
        return reply(500, { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'api-motion: /api/motion/export')

  // The exported film, seekable.
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/motion/film',
    methods: ['GET', 'HEAD'],
    fetch: async (request) => {
      const path = new URL(request.url).searchParams.get('path')
      if (path === null || path.includes('\0') || !isAbsolute(path) || extname(path).toLowerCase() !== '.mp4') {
        return reply(400, 'absolute .mp4 path required')
      }
      return serveFilm(request, path)
    },
  }), 'api-motion: /api/motion/film')
}
