/**
 * Browser routes behind the Motion card on a Host that renders motion films: the live preview bundle of a
 * composition folder, the user's export of that folder to an MP4, and the exported film's bytes. Every route
 * sits behind the connection service's authentication; like `/api/file`, a path names any local folder or
 * file the authenticated account may read.
 * @module @aeven/api-motion
 */
import { createReadStream } from 'node:fs'
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, extname, isAbsolute, join } from 'node:path'
import { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@aeven/client-connection'
import type { MotionQuality } from '@aeven/motion'
import type {} from '@aeven/motion'
import type {} from '@aeven/api-session-controller'
import type {} from '@aeven/fs'
import type {} from '@aeven/sandbox-policy'
import { brandString } from '@aeven/brand'
import type { SessionId } from '@aeven/session'
import { bundleToSingleHtml } from '@hyperframes/core/compiler'
import { ExportJobs, freshExport, recordExport, type ExportedFilm, type ExportOutcome } from './exports.ts'
import { replayComposition } from './replay.ts'

export const name = 'api-motion'
/**
 * The connection service carries every route. The preview, export, and film routes read Host paths and register only
 * while `ctx.motion` exists and `folderRoutes` is on; the replay route reads only the caller's own conversation and
 * registers while `ctx.sessionController` exists, so hosted Web, which turns the folder routes off, serves replays alone.
 */
export const inject = ['connection']

/** Route configuration. */
export interface Config {
  /** Quality of a film the user exports from the card. */
  exportQuality: MotionQuality
  /**
   * Whether the preview, export, and film routes register while `ctx.motion` exists. They read any absolute Host
   * path the request names, so a Host serving several accounts, whose card plays the film stored with the call,
   * turns them off.
   */
  folderRoutes: boolean
  /**
   * How long one export request waits for its render, in milliseconds, before answering 202 with the render's
   * progress so the card shows it and asks again; also keeps each request inside a proxy's read timeout.
   */
  exportWaitMs: number
}

export const Config: z<Config> = z.object({
  exportQuality: z.union(['draft', 'standard', 'high'] as const).default('high'),
  folderRoutes: z.boolean().default(true),
  exportWaitMs: z.natural().min(250).default(1_500),
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
 * Bundle a composition rebuilt from the conversation log in a private scratch folder. The bundler inlines only
 * files inside the folder, so nothing outside the rebuilt files reaches the document.
 * @param files - the folder's files by slash-separated relative path.
 * @returns the bundled document.
 */
async function bundleFiles(files: ReadonlyMap<string, string>): Promise<string> {
  const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-replay-'))
  try {
    for (const [path, text] of files) {
      const target = join(scratch, ...path.split('/'))
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, text, { flag: 'wx' })
    }
    return await bundleToSingleHtml(scratch, { runtime: 'inline' })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * Register the replay route, and the preview, export, and film routes while a motion renderer exists and
 * `folderRoutes` is on.
 * @param ctx - context carrying the connection service.
 * @param config - export quality and whether the folder routes register.
 */
export function apply(ctx: Context, config: Config): void {
  // A film shown on another of the account's devices: its composition rebuilt from this conversation's log.
  ctx.inject(['sessionController'], (sessionCtx) => {
    sessionCtx.effect(() => sessionCtx.connection.fetch.register({
      path: '/api/motion/replay',
      methods: ['GET'],
      fetch: async (request) => {
        const params = new URL(request.url).searchParams
        const sessionId = params.get('sessionId')
        const callId = params.get('callId')
        if (sessionId === null || sessionId === '' || callId === null || callId === '') return reply(400, 'sessionId and callId required')
        let events
        try {
          events = (await sessionCtx.sessionController.inspect(brandString<SessionId>(sessionId), request.signal)).events
        } catch {
          // A missing Session and another account's Session both read as absent.
          return reply(404, 'not found')
        }
        const replay = replayComposition(events, callId)
        if ('error' in replay) return reply(404, replay.error)
        try {
          return reply(200, await bundleFiles(replay.files))
        } catch (error) {
          return reply(422, error instanceof Error ? error.message : String(error))
        }
      },
    }), 'api-motion: /api/motion/replay')
  })
  if (config.folderRoutes) ctx.inject(['motion'], (motionCtx) => { registerFolderRoutes(motionCtx, config) })
  // With the folder routes off, the preview answers that no folder is served, so the card plays the stored film
  // without a failed request.
  else {
    ctx.effect(() => ctx.connection.fetch.register({
      path: '/api/motion/preview',
      methods: ['GET'],
      fetch: () => Promise.resolve(new Response(null, { status: 204, headers: BASE_HEADERS })),
    }), 'api-motion: /api/motion/preview (no folders)')
  }
  ctx.inject(['motion', 'sessionController', 'fs'], (callCtx) => { registerCallExport(callCtx, config) })
}

/**
 * Export a composition folder into `renders/<folder>.mp4` at the configured quality, joining a render already
 * running under `key` and reusing an export no file of the folder changed since.
 * @param ctx - context carrying the motion renderer.
 * @param jobs - the route's running exports.
 * @param key - the folder or call the export is for.
 * @param dir - absolute composition folder.
 * @param quality - export quality.
 * @param signal - the export's lifetime, which outlasts the requests asking for it.
 * @param sandboxPolicy - the caller's sandbox policy, for a renderer confined to the account's sandbox.
 * @returns the film, the render's failure, or its progress.
 */
function exportFolder(
  ctx: Context, jobs: ExportJobs, key: string, dir: string, quality: MotionQuality, signal: AbortSignal,
  sandboxPolicy?: ReturnType<Context['sandboxPolicy']['resolve']>,
): Promise<ExportOutcome> {
  const outputPath = join(dir, 'renders', `${basename(dir)}.mp4`)
  return jobs.request(key, async (onProgress): Promise<ExportedFilm> => {
    const fresh = await freshExport(dir, outputPath, quality)
    if (fresh !== undefined) return fresh
    const spec = ctx.motion.resolve({ compositionDir: dir, outputPath, quality, ...sandboxPolicy === undefined ? {} : { sandboxPolicy } })
    const film = await ctx.motion.render(spec, signal, onProgress)
    await recordExport(film, quality)
    return film
  })
}

/**
 * The 202 answer of an export still rendering: how far it has come, and whether it waits for another render.
 * @param progress - the render's latest progress.
 * @returns the response the card polls on.
 */
function pending(progress: { fraction: number; queued: boolean }): Response {
  return reply(202, { pending: true, fraction: progress.fraction, queued: progress.queued })
}

/**
 * Register the preview, export, and film routes, which read the Host's own folders.
 * @param ctx - context carrying the connection service and the motion renderer.
 * @param config - export quality.
 */
function registerFolderRoutes(ctx: Context, config: Config): void {
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

  // The user's export into `renders/<folder>.mp4`: one render per folder, joined by every request while it runs, each
  // answered with the render's progress until it finishes. A render outlives the requests and ends with this
  // registration.
  const jobs = new ExportJobs(config.exportWaitMs)
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'api-motion: folder export renders')
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
      const outcome = await exportFolder(ctx, jobs, dir, dir, config.exportQuality, lifetime.signal)
      if ('pending' in outcome) return pending(outcome.pending)
      if ('error' in outcome) return reply(500, { message: outcome.error instanceof Error ? outcome.error.message : String(outcome.error) })
      const response: MotionExportResponse = {
        path: outcome.film.outputPath,
        bytes: outcome.film.bytes,
        durationSeconds: outcome.film.durationSeconds,
        width: outcome.film.width,
        height: outcome.film.height,
      }
      return reply(200, response)
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

/**
 * The composition folder one `show_motion` call recorded in a conversation's log.
 * @param events - the conversation's events.
 * @param callId - the call.
 * @returns the absolute folder, or undefined when the log holds no such call.
 */
function recordedFolder(events: readonly { readonly type: string; readonly data?: unknown }[], callId: string): string | undefined {
  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const data = event.data as { readonly message?: { readonly source?: { readonly callId?: unknown } }; readonly meta?: unknown }
    if (data.message?.source?.callId !== callId) continue
    const meta = data.meta as { readonly compositionDir?: unknown } | undefined
    return typeof meta?.compositionDir === 'string' ? meta.compositionDir : undefined
  }
  return undefined
}

/**
 * Register the export of a film named by its conversation and call: the composition folder comes from the caller's
 * own log, and the render runs under that conversation's sandbox policy, so a Host serving many accounts renders
 * only inside the caller's own workspace. The response carries the MP4 itself, or 202 while the render continues
 * past `exportWaitMs`; asking again joins the same render.
 * @param ctx - context carrying the connection service, the motion renderer, the session controller, and the filesystem.
 * @param config - export quality.
 */
function registerCallExport(ctx: Context, config: Config): void {
  // Renders in progress by conversation and call, so a repeated request joins the running render.
  const jobs = new ExportJobs(config.exportWaitMs)
  // A render outlives the request that started it and ends with this registration.
  const lifetime = new AbortController()
  ctx.effect(() => () => { lifetime.abort() }, 'api-motion: export renders')
  ctx.effect(() => ctx.connection.fetch.register({
    path: '/api/motion/export-call',
    methods: ['POST'],
    fetch: async (request) => {
      let body: { sessionId?: unknown; callId?: unknown }
      try {
        body = await request.json() as { sessionId?: unknown; callId?: unknown }
      } catch {
        // A body that is not JSON names no call; the check below answers it.
        body = {}
      }
      if (typeof body.sessionId !== 'string' || body.sessionId === '' || typeof body.callId !== 'string' || body.callId === '') {
        return reply(400, 'sessionId and callId required')
      }
      // Another account's conversation reads as absent.
      const found = await ctx.sessionController.resolveAgent(brandString<SessionId>(body.sessionId))
      if ('error' in found) return reply(404, 'not found')
      const session = found.agent.session
      const dir = recordedFolder(session.snapshotEvents(), body.callId)
      if (dir === undefined) return reply(404, 'the conversation shows no film for this call')
      const index = await stat(join(dir, 'index.html')).catch(() => undefined)
      if (index?.isFile() !== true) return reply(404, { code: 'FOLDER_ABSENT', message: 'the film\'s folder is not on this device' })
      const policy = ctx.get('sandboxPolicy')?.resolve({ session })
      const waited = await exportFolder(ctx, jobs, `${body.sessionId}\u0000${body.callId}`, dir, config.exportQuality, lifetime.signal, policy)
      if ('pending' in waited) return pending(waited.pending)
      if ('error' in waited) return reply(500, { message: waited.error instanceof Error ? waited.error.message : String(waited.error) })
      try {
        const film = waited.film
        const target = await ctx.fs.resolve(film.outputPath, { signal: request.signal })
        const data = await ctx.fs.readBytes(target, request.signal, Math.max(1, film.bytes))
        return new Response(new Uint8Array(data), {
          status: 200,
          headers: {
            ...BASE_HEADERS,
            'Content-Type': 'video/mp4',
            'Content-Length': String(data.byteLength),
            'Content-Disposition': `attachment; filename="${basename(film.outputPath).replaceAll('"', '')}"`,
          },
        })
      } catch (error) {
        return reply(500, { message: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'api-motion: /api/motion/export-call')
}
