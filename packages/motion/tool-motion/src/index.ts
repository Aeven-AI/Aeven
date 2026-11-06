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
import { MOTION_SKILL } from './skill.ts'

export const name = 'tool-motion'
/**
 * The renderer, tool registry, durable storage, and the filesystem that resolves workspace paths must exist;
 * `skills` is optional and only adds `/motion`.
 */
export const inject = ['motion', 'tools', 'attachments', 'fs']

/** Tool limits. */
export interface Config {
  /** Most stills one call may request. */
  maxStills: number
}

export const Config: z<Config> = z.object({
  maxStills: z.natural().max(16).default(8),
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
 * Register `show_motion`, `render_motion`, and the `motion` skill.
 * @param ctx - context carrying the motion renderer, the tool registry, and attachments.
 * @param config - still limit.
 */
export function apply(ctx: Context, config: Config): void {
  ctx.inject(['skills'], (skillCtx) => {
    skillCtx.effect(() => skillCtx.skills.register(MOTION_SKILL), 'tool-motion: motion skill')
  })

  ctx.tools.register(defineTool({
    name: 'show_motion',
    description: 'Show a HyperFrames composition folder to the user as a live film they can play, scrub, and export to MP4. Call it after writing or changing a composition. The folder holds index.html, its scene files under compositions/, and assets/. Showing renders nothing and returns at once; requesting stills adds a fast draft render whose evenly spaced frames come back for your review. The film plays directly for the user; do not repeat or embed it in your reply.',
    parameters: {
      composition: { type: 'string', required: true, description: 'Composition folder, relative to the working directory.' },
      stills: { type: 'integer', description: `Evenly spaced frames returned to you for review, 0 to ${String(config.maxStills)}. Omit for none.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          compositionDir: { type: 'string', required: true },
          durationSeconds: { type: 'number' },
          stills: STILLS_SCHEMA,
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `Showing ${value.path} to the user as a live film with an Export to MP4 button${value.durationSeconds === undefined ? '' : ` (${value.durationSeconds.toFixed(2)} s)`}.`,
            'Do not repeat or embed it in your reply, and do not render an MP4 unless the user asks for the file.',
            ...stillsText(value.stills),
          ].join(' '),
        },
        ...value.stills.map(still => ({ type: 'image' as const, attachment: imageBlockRef(still) })),
      ],
      // The card plays the folder through the Host's preview route, which takes the absolute path.
      presentationMeta: (_args, value) => ({ compositionDir: value.compositionDir }),
    },
    async execute(args: { composition: string; stills?: number }, exec) {
      checkStills(args.stills, config.maxStills)
      const compositionDir = await localPath(ctx, exec, args.composition)
      const index = await stat(join(compositionDir, 'index.html')).catch(() => undefined)
      if (index?.isFile() !== true) throw new Error(`${args.composition} has no index.html`)
      if (args.stills === undefined || args.stills === 0) return { path: args.composition, compositionDir, stills: [] }
      const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-review-'))
      try {
        const spec = ctx.motion.resolve({ compositionDir, outputPath: join(scratch, 'review.mp4'), quality: 'draft', stills: args.stills })
        const film = await ctx.motion.render(spec, exec.signal)
        const stills = await saveStills(ctx, basename(compositionDir), film.stills)
        return { path: args.composition, compositionDir, durationSeconds: film.durationSeconds, stills }
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    },
  }))

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
