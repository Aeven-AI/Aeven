/**
 * Model-facing `render_motion` tool and the `motion` skill over `ctx.motion`. The tool renders a HyperFrames
 * composition folder from the session's workspace into an MP4 inside it, stores the film as a file attachment
 * that the conversation plays at the call, and returns optional stills the model reviews its work from. The
 * skill teaches the composition rules and the author-render-review loop. Both register only while a motion
 * renderer exists, so a composition without one shows neither.
 * @module @aeven/tool-motion
 */
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, isAbsolute, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FileAttachmentRef, ImageAttachmentRef } from '@aeven/attachment'
import type {} from '@aeven/attachment'
import type {} from '@aeven/fs'
import type { MotionFps, MotionQuality, MotionStill } from '@aeven/motion'
import type {} from '@aeven/motion'
import type {} from '@aeven/sandbox-policy'
import type {} from '@aeven/skill'
import { FILE_ATTACHMENT_PROPERTIES, fileBlockRef, imageBlockRef } from '@aeven/tool-media'
import { defineTool } from '@aeven/tools'
import type { ToolRunContext } from '@aeven/tools'
import { sessionDirectory, sessionWorkspaceRoot } from '@aeven/working-directory'
import { motionSkill } from './skill.ts'

export const name = 'tool-motion'
/**
 * The tool registry, durable storage, and the filesystem that resolves workspace paths must exist. The renderer
 * is optional: the tools and skill register only while `ctx.motion` exists, so a composition without one, such
 * as hosted Web sharing the `aeven` preset, activates this plugin with nothing registered. `skills` is optional and
 * only adds `/motion`.
 */
export const inject = ['tools', 'attachments', 'fs']

/** Tool limits and the film rendering the deployment offers. */
export interface Config {
  /** Most stills one call may request. */
  maxStills: number
  /**
   * Whether the registered renderer writes films. When false, as on a Host whose renderer only bundles compositions
   * for the live player, `show_motion` takes no stills, `render_motion` is not registered, and the skill teaches
   * the show-only loop.
   */
  render: boolean
}

export const Config: z<Config> = z.object({
  maxStills: z.natural().max(16).default(8),
  render: z.boolean().default(true),
})

const FPS: readonly MotionFps[] = [24, 30, 60]
const QUALITIES: readonly MotionQuality[] = ['draft', 'standard', 'high']

/** Arguments the model passes. */
interface RenderMotionArgs {
  composition: string
  output?: string
  fps?: number
  quality?: string
  stills?: number
}

/**
 * Resolve a model-supplied path the way the filesystem tools do: against the session's working directory, or,
 * for a session that records none (a chat), the sandbox policy's workspace root, else the filesystem backend's
 * own default. The path must stay inside the session's workspace root, or the policy's when the session has none.
 * @param ctx - plugin context carrying `ctx.fs`.
 * @param exec - the call's run context.
 * @param path - relative or absolute path the model wrote.
 * @returns the absolute local path.
 * @throws When the backend resolves to no local path, or the path leaves the workspace root.
 */
async function localPath(ctx: Context, exec: Pick<ToolRunContext, 'agent' | 'signal'>, path: string): Promise<string> {
  const session = exec.agent?.session
  const policyRoot = session === undefined ? undefined : ctx.get('sandboxPolicy')?.resolve({ session }).workspaceRoot
  const cwd = (session === undefined ? undefined : sessionDirectory(ctx, session)) ?? policyRoot
  const target = await ctx.fs.resolve(path, { ...cwd === undefined ? {} : { cwd }, signal: exec.signal })
  if (!isAbsolute(target.displayPath)) throw new Error('render_motion needs a workspace folder on this device')
  const root = (session === undefined ? undefined : sessionWorkspaceRoot(ctx, session)) ?? policyRoot
  if (root !== undefined) {
    const inside = relative(root, target.displayPath)
    if (inside.startsWith('..') || isAbsolute(inside)) throw new Error(`${path} is outside the workspace`)
  }
  return target.displayPath
}

/** Output schema of the stills a call returns; each is a stored image reference plus its film time. */
const STILLS_SCHEMA = {
  type: 'array',
  required: true,
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      seconds: { type: 'number', required: true },
      attachmentId: { type: 'string', required: true },
      mediaType: { type: 'string', required: true },
      bytes: { type: 'integer', required: true },
      width: { type: 'integer', required: true },
      height: { type: 'integer', required: true },
      name: { type: 'string' },
      originalDimensions: {
        type: 'object',
        additionalProperties: false,
        properties: {
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
        },
      },
    },
  },
} as const

/** One stored still. */
type StoredStill = ImageAttachmentRef & { seconds: number }

/**
 * Store stills as image attachments.
 * @param ctx - context carrying `ctx.attachments`.
 * @param name - film name the still names start with.
 * @param stills - PNG frames from the renderer.
 * @returns stored references in film order.
 */
async function saveStills(ctx: Context, name: string, stills: readonly MotionStill[]): Promise<StoredStill[]> {
  const stored: StoredStill[] = []
  for (const still of stills) {
    const ref = await ctx.attachments.saveImage({ data: still.png, mediaType: 'image/png', name: `${name}-${String(still.seconds)}s.png` })
    stored.push({ ...ref, seconds: still.seconds })
  }
  return stored
}

/**
 * Store the composition bundled into one document, so a device that lacks the folder can still play the film.
 * @param ctx - context carrying `ctx.motion` and `ctx.attachments`.
 * @param compositionDir - absolute composition folder.
 * @param path - the folder as the model named it, for the stored file's description.
 * @returns the stored reference, or undefined when bundling or storing fails; the folder still plays on this device.
 */
async function saveFilm(ctx: Context, compositionDir: string, path: string): Promise<FileAttachmentRef | undefined> {
  const name = `${basename(compositionDir)}.html`
  try {
    return await ctx.attachments.saveFile({
      data: new TextEncoder().encode(await ctx.motion.bundle(compositionDir)),
      mediaType: 'text/html',
      name,
      text: {
        text: `Motion film ${name}, bundled from ${path} into one self-contained page.`,
        method: 'native',
        extractor: 'tool-motion',
        truncated: false,
      },
    })
  } catch (error) {
    // A composition the bundler rejects, or one over the attachment size limit, keeps only its live preview.
    ctx.logger('tool-motion').warn('show_motion: film not stored for other devices: %s', error instanceof Error ? error.message : String(error))
    return undefined
  }
}

/**
 * The sentence that introduces returned stills, or nothing when there are none.
 * @param stills - stored stills.
 * @returns the sentence as a one-element list, or an empty list.
 */
function stillsText(stills: readonly { seconds: number }[]): string[] {
  return stills.length === 0 ? [] : [`Stills at ${stills.map(still => `${String(still.seconds)} s`).join(', ')} follow for your review.`]
}

/**
 * Validate a requested still count.
 * @param stills - the count the model passed.
 * @param max - configured maximum.
 * @throws When the count is not an integer from 0 to `max`.
 */
function checkStills(stills: number | undefined, max: number): void {
  if (stills !== undefined && (!Number.isInteger(stills) || stills < 0 || stills > max)) {
    throw new Error(`stills must be an integer from 0 to ${String(max)}`)
  }
}

/**
 * Register `show_motion`, `render_motion`, and the `motion` skill while a motion renderer exists.
 * @param ctx - context carrying the tool registry, attachments, and the filesystem.
 * @param config - still limit.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['motion'], (motionCtx) => { registerMotion(motionCtx, config) })
}

/**
 * Register the tools and skill on a context that carries `ctx.motion`; they unregister with it.
 * @param ctx - context carrying the motion renderer, the tool registry, attachments, and the filesystem.
 * @param config - still limit.
 */
function registerMotion(ctx: Context, config: Config): void {
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(() => skillCtx.skills.register(motionSkill(config.render)), 'tool-motion: motion skill')
  })

  ctx.tools.register(defineTool({
    name: 'show_motion',
    description: config.render
      ? 'Show a HyperFrames composition folder to the user as a live film they can play, scrub, and export to MP4. Call it after writing or changing a composition. The folder holds index.html, its scene files under compositions/, and assets/. Showing renders nothing and returns at once; requesting stills adds a fast draft render whose evenly spaced frames come back for your review. The film plays directly for the user; do not repeat or embed it in your reply.'
      : 'Show a HyperFrames composition folder to the user as a live film they can play and scrub. Call it after writing or changing a composition. The folder holds index.html, its scene files under compositions/, and assets/. Showing returns at once. The film plays directly for the user; do not repeat or embed it in your reply.',
    parameters: {
      composition: { type: 'string', required: true, description: 'Composition folder, relative to the working directory.' },
      ...config.render
        ? { stills: { type: 'integer', description: `Evenly spaced frames returned to you for review, 0 to ${String(config.maxStills)}. Omit for none.` } }
        : {},
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          compositionDir: { type: 'string', required: true },
          durationSeconds: { type: 'number' },
          film: {
            type: 'object',
            additionalProperties: false,
            properties: FILE_ATTACHMENT_PROPERTIES,
          },
          stills: STILLS_SCHEMA,
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `Showing ${value.path} to the user as a live film${config.render ? ' with an Export to MP4 button' : ''}${value.durationSeconds === undefined ? '' : ` (${value.durationSeconds.toFixed(2)} s)`}.`,
            config.render
              ? 'Do not repeat or embed it in your reply, and do not render an MP4 unless the user asks for the file.'
              : 'Do not repeat or embed it in your reply.',
            ...stillsText(value.stills),
          ].join(' '),
        },
        ...value.stills.map(still => ({ type: 'image' as const, attachment: imageBlockRef(still) })),
      ],
      // The card plays the folder through the Host's preview route, which takes the absolute path, and plays the
      // stored film where that Host lacks the folder, such as another of the account's devices.
      presentationMeta: (_args, value) => ({
        compositionDir: value.compositionDir,
        ...value.film === undefined ? {} : { film: value.film },
      }),
    },
    async execute(args: { composition: string; stills?: number }, exec) {
      // Undeclared keys are allowed, so schema omission also needs enforcement.
      if (!config.render && args.stills !== undefined) throw new Error('stills are not available here')
      checkStills(args.stills, config.maxStills)
      const compositionDir = await localPath(ctx, exec, args.composition)
      const index = await stat(join(compositionDir, 'index.html')).catch(() => undefined)
      if (index?.isFile() !== true) throw new Error(`${args.composition} has no index.html`)
      const film = await saveFilm(ctx, compositionDir, args.composition)
      const shown = { path: args.composition, compositionDir, ...film === undefined ? {} : { film } }
      if (args.stills === undefined || args.stills === 0) return { ...shown, stills: [] }
      const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-review-'))
      try {
        const spec = ctx.motion.resolve({ compositionDir, outputPath: join(scratch, 'review.mp4'), quality: 'draft', stills: args.stills })
        const review = await ctx.motion.render(spec, exec.signal)
        const stills = await saveStills(ctx, basename(compositionDir), review.stills)
        return { ...shown, durationSeconds: review.durationSeconds, stills }
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    },
  }))

  if (!config.render) return
  ctx.tools.register(defineTool({
    name: 'render_motion',
    description: 'Render a HyperFrames composition folder to an H.264 MP4 file and attach it to the conversation. Call only when the user asks for the video file; show_motion already lets the user watch and export the film. Rendering takes about as long as the film plays, longer at high quality. The film is displayed directly to the user; do not repeat or embed it in your reply.',
    parameters: {
      composition: { type: 'string', required: true, description: 'Composition folder, relative to the working directory.' },
      output: { type: 'string', description: 'MP4 path to write, relative to the working directory. Omit to write renders/<folder>.mp4 inside the composition folder.' },
      fps: { type: 'integer', description: 'Frame rate: 24, 30, or 60. Omit for 30.' },
      quality: { type: 'string', description: "'draft' for fast review renders, 'standard', or 'high' for delivery. Omit for standard." },
      stills: { type: 'integer', description: `Evenly spaced frames of the finished film returned to you for review, 0 to ${String(config.maxStills)}. Omit for none.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          durationSeconds: { type: 'number', required: true },
          width: { type: 'integer', required: true },
          height: { type: 'integer', required: true },
          bytes: { type: 'integer', required: true },
          storageError: { type: 'string' },
          video: {
            type: 'object',
            additionalProperties: false,
            properties: FILE_ATTACHMENT_PROPERTIES,
          },
          stills: STILLS_SCHEMA,
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `Rendered ${value.path}: ${value.durationSeconds.toFixed(2)} s, ${String(value.width)}x${String(value.height)}.`,
            value.video === undefined
              ? `The film could not be attached to the conversation (${value.storageError ?? 'unknown error'}); tell the user where the file is.`
              : 'Already displayed to the user with playback and download controls; do not repeat or embed it in your reply.',
            ...stillsText(value.stills),
          ].join(' '),
        },
        ...value.video === undefined ? [] : [{ type: 'file' as const, attachment: fileBlockRef(value.video) }],
        ...value.stills.map(still => ({ type: 'image' as const, attachment: imageBlockRef(still) })),
      ],
    },
    async execute(args: RenderMotionArgs, exec) {
      const compositionDir = await localPath(ctx, exec, args.composition)
      const outputPath = await localPath(ctx, exec, args.output ?? join(compositionDir, 'renders', `${basename(compositionDir)}.mp4`))
      if (!outputPath.toLowerCase().endsWith('.mp4')) throw new Error('output must end in .mp4')
      if (args.fps !== undefined && !FPS.includes(args.fps as MotionFps)) throw new Error('fps must be 24, 30, or 60')
      if (args.quality !== undefined && !QUALITIES.includes(args.quality as MotionQuality)) throw new Error("quality must be 'draft', 'standard', or 'high'")
      checkStills(args.stills, config.maxStills)
      const spec = ctx.motion.resolve({
        compositionDir,
        outputPath,
        ...args.fps === undefined ? {} : { fps: args.fps as MotionFps },
        ...args.quality === undefined ? {} : { quality: args.quality as MotionQuality },
        ...args.stills === undefined ? {} : { stills: args.stills },
      })
      const film = await ctx.motion.render(spec, exec.signal)
      const name = basename(film.outputPath)
      let video: FileAttachmentRef | undefined
      let storageError: string | undefined
      try {
        video = await ctx.attachments.saveFile({
          data: new Uint8Array(await readFile(film.outputPath)),
          mediaType: 'video/mp4',
          name,
          text: {
            text: `Motion film ${name}: ${film.durationSeconds.toFixed(2)} s at ${String(film.width)}x${String(film.height)}, rendered from ${args.composition}.`,
            method: 'native',
            extractor: 'tool-motion',
            truncated: false,
          },
        })
      } catch (error) {
        // The MP4 is already on disk; a store refusal (such as the attachment size limit) leaves it there for the user.
        storageError = error instanceof Error ? error.message : String(error)
      }
      const stills = await saveStills(ctx, name, film.stills)
      return {
        path: args.output ?? join(args.composition, 'renders', `${basename(compositionDir)}.mp4`),
        durationSeconds: film.durationSeconds,
        width: film.width,
        height: film.height,
        bytes: film.bytes,
        ...video === undefined ? {} : { video },
        ...storageError === undefined ? {} : { storageError },
        stills,
      }
    },
  }))
}
