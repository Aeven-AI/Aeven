/**
 * Model-facing motion tools and the `motion` skill over `ctx.motion`. `show_motion` presents a HyperFrames
 * composition folder to the user as a live film and renders nothing; `review_motion` renders a draft and returns
 * stills at chosen times to the model alone, so checking a film never replaces the one on the user's screen;
 * `render_motion` writes an MP4 the user asked for. Both showing and reviewing first read the folder statically
 * and refuse a composition that cannot render as written, and showing refuses a film far shorter than the one
 * last shown from the same folder unless the call says the cut is intended. The skill teaches the composition
 * rules and the author, review, show loop. Everything registers only while a motion renderer exists, so a
 * composition without one shows none of it.
 * @module @aeven/tool-motion
 */
import { basename, isAbsolute, join, relative } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FileAttachmentRef, ImageAttachmentRef } from '@aeven/attachment'
import type {} from '@aeven/attachment'
import type {} from '@aeven/fs'
import { recordRender, type MotionFps, type MotionQuality, type MotionStill } from '@aeven/motion'
import type {} from '@aeven/motion'
import type {} from '@aeven/sandbox-policy'
import type { SandboxExecutionPolicy } from '@aeven/sandbox'
import type {} from '@aeven/skill'
import { FILE_ATTACHMENT_PROPERTIES, fileBlockRef, imageBlockRef } from '@aeven/tool-media'
import { defineTool } from '@aeven/tools'
import type { ToolRunContext } from '@aeven/tools'
import { sessionDirectory, sessionWorkspaceRoot } from '@aeven/working-directory'
import { readComposition, spacedTimes, type CompositionFacts } from './composition.ts'
import { MOTION_SKILL } from './skill.ts'

export const name = 'tool-motion'
/**
 * The tool registry, durable storage, and the filesystem that resolves workspace paths must exist. The renderer
 * is optional: the tools and skill register only while `ctx.motion` exists, so a composition without one, such
 * as hosted Web sharing the `aeven` preset, activates this plugin with nothing registered. `skills` is optional and
 * only adds `/motion`.
 */
export const inject = ['tools', 'attachments', 'fs']

/** Tool limits. */
export interface Config {
  /** Most stills one `render_motion` call may request. */
  maxStills: number
  /** Most stills one `review_motion` call may request. */
  maxReviewStills: number
  /**
   * Share of the length last shown from a folder below which `show_motion` refuses a film unless the call passes
   * `force`: a film cut that far is usually mid-edit, such as an index trimmed for a check.
   */
  shrinkRatio: number
  /**
   * Quality of a `review_motion` render. Matching the export quality lets the user's export reuse the last review
   * of an unchanged folder instead of rendering it again; capture, not encoding, sets the render time.
   */
  reviewQuality: MotionQuality
}

export const Config: z<Config> = z.object({
  maxStills: z.natural().max(16).default(8),
  maxReviewStills: z.natural().min(1).max(16).default(12),
  shrinkRatio: z.number().min(0).max(1).default(0.5),
  reviewQuality: z.union(['draft', 'standard', 'high'] as const).default('high'),
})

const FPS: readonly MotionFps[] = [24, 30, 60]
const QUALITIES: readonly MotionQuality[] = ['draft', 'standard', 'high']

/** Arguments of `review_motion`. */
interface ReviewMotionArgs {
  composition: string
  times?: number[]
  scene?: string
  stills?: number
}

/** Stills a review takes when the call names neither times nor a count. */
const DEFAULT_REVIEW_STILLS = 8

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

/**
 * The calling session's sandbox policy, which a renderer that runs inside the account's sandbox requires.
 * @param ctx - plugin context with the optional `ctx.sandboxPolicy`.
 * @param exec - the call's run context.
 * @returns the policy, or undefined for a call without a session or a Host without sandbox policy.
 */
function sandboxPolicyOf(ctx: Context, exec: Pick<ToolRunContext, 'agent'>): SandboxExecutionPolicy | undefined {
  const session = exec.agent?.session
  return session === undefined ? undefined : ctx.get('sandboxPolicy')?.resolve({ session })
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
 * Read a composition folder, naming the folder as the model wrote it in a refusal.
 * @param compositionDir - absolute folder.
 * @param path - the folder as the model named it.
 * @returns the film's length and scenes.
 * @throws When the folder cannot render as written.
 */
async function compositionFacts(compositionDir: string, path: string): Promise<CompositionFacts> {
  try {
    return await readComposition(compositionDir)
  } catch (error) {
    throw new Error(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * The film times a review takes stills at: the call's own times, else evenly spaced through one scene's window
 * or the whole film.
 * @param args - the call's arguments.
 * @param facts - the composition's length and scenes.
 * @param max - most stills one review returns.
 * @returns the times, in seconds.
 * @throws When the arguments combine times with a scene, name an unknown scene, or ask for times outside the film
 *   or more stills than `max`.
 */
function reviewTimes(args: ReviewMotionArgs, facts: CompositionFacts, max: number): number[] {
  if (args.times !== undefined) {
    if (args.scene !== undefined || args.stills !== undefined) throw new Error('pass times on their own, without scene or stills')
    if (args.times.length === 0 || args.times.length > max) throw new Error(`times takes 1 to ${String(max)} values`)
    for (const time of args.times) {
      if (!Number.isFinite(time) || time < 0 || time > facts.durationSeconds) {
        throw new Error(`each time must lie within the film, 0 to ${String(facts.durationSeconds)} s`)
      }
    }
    return args.times
  }
  const count = args.stills ?? DEFAULT_REVIEW_STILLS
  if (!Number.isInteger(count) || count < 1 || count > max) throw new Error(`stills must be an integer from 1 to ${String(max)}`)
  if (args.scene === undefined) return spacedTimes(0, facts.durationSeconds, count)
  const scene = facts.scenes.find(candidate => candidate.id === args.scene)
  if (scene === undefined) {
    throw new Error(`no scene "${args.scene}"; the film hosts ${facts.scenes.map(candidate => candidate.id).join(', ') || 'none'}`)
  }
  return spacedTimes(scene.start, scene.duration, count)
}

/**
 * Register `show_motion`, `review_motion`, `render_motion`, and the `motion` skill while a motion renderer exists.
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
    skillCtx.effect(() => skillCtx.skills.register(MOTION_SKILL), 'tool-motion: motion skill')
  })

  // The length each folder was last shown at, per session, which a far shorter re-show is checked against.
  const shown = new Map<string, number>()

  ctx.tools.register(defineTool({
    name: 'show_motion',
    description: 'Show a HyperFrames composition folder to the user as a live film they can play, scrub, and export to MP4. The folder holds index.html, its scene files under compositions/, and assets/. Call it once a round of changes is finished and checked with review_motion: each call replaces the film on the user\'s screen. Showing renders nothing and returns at once. A film far shorter than the one last shown from the same folder is refused as mid-edit; pass force when the cut is intended. The film plays directly for the user; do not repeat or embed it in your reply.',
    parameters: {
      composition: { type: 'string', required: true, description: 'Composition folder, relative to the working directory.' },
      force: { type: 'boolean', description: 'Show the film even though it is far shorter than the one last shown from this folder. Omit unless the cut is intended.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          compositionDir: { type: 'string', required: true },
          durationSeconds: { type: 'number', required: true },
          film: {
            type: 'object',
            additionalProperties: false,
            properties: FILE_ATTACHMENT_PROPERTIES,
          },
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `Showing ${value.path} to the user as a live film with an Export to MP4 button (${value.durationSeconds.toFixed(2)} s).`,
            'Do not repeat or embed it in your reply, and do not render an MP4 unless the user asks for the file.',
          ].join(' '),
        },
      ],
      // The card plays the folder through the Host's preview route, which takes the absolute path, and plays the
      // stored film where that Host lacks the folder, such as another of the account's devices.
      presentationMeta: (_args, value) => ({
        compositionDir: value.compositionDir,
        durationSeconds: value.durationSeconds,
        ...value.film === undefined ? {} : { film: value.film },
      }),
    },
    async execute(args: { composition: string; force?: boolean }, exec) {
      const compositionDir = await localPath(ctx, exec, args.composition)
      const facts = await compositionFacts(compositionDir, args.composition)
      const key = `${exec.agent?.session.id ?? ''}\u0000${compositionDir}`
      const previous = shown.get(key)
      if (previous !== undefined && args.force !== true && facts.durationSeconds < previous * config.shrinkRatio) {
        throw new Error(`${args.composition} is ${String(facts.durationSeconds)} s long; it was ${String(previous)} s when last shown. A film cut this far is usually mid-edit, such as an index trimmed for a check, which review_motion does without touching the film. Restore the film, or pass force: true if the shorter cut is intended.`)
      }
      const film = await saveFilm(ctx, compositionDir, args.composition)
      shown.set(key, facts.durationSeconds)
      return { path: args.composition, compositionDir, durationSeconds: facts.durationSeconds, ...film === undefined ? {} : { film } }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'review_motion',
    description: 'Render a HyperFrames composition folder and return stills to you alone, to check your work; the user sees nothing of it and the film on their screen stays as it is. Take stills at exact film times, spread through one scene, or spread through the whole film. Rendering takes about as long as the film plays. Review after every round of edits, and call show_motion only once the stills look right.',
    parameters: {
      composition: { type: 'string', required: true, description: 'Composition folder, relative to the working directory.' },
      times: { type: 'array', items: { type: 'number' }, description: `Film times in seconds to take stills at, 1 to ${String(config.maxReviewStills)}. Use alone, without scene or stills.` },
      scene: { type: 'string', description: 'Id of one scene index.html hosts; the stills spread through its window only.' },
      stills: { type: 'integer', description: `How many evenly spaced stills, 1 to ${String(config.maxReviewStills)}. Omit for ${String(DEFAULT_REVIEW_STILLS)}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          path: { type: 'string', required: true },
          durationSeconds: { type: 'number', required: true },
          stills: STILLS_SCHEMA,
        },
      },
      render: (_args, value) => [
        {
          type: 'text',
          text: [
            `Reviewed ${value.path} (${value.durationSeconds.toFixed(2)} s); the user does not see this review.`,
            ...stillsText(value.stills),
          ].join(' '),
        },
        ...value.stills.map(still => ({ type: 'image' as const, attachment: imageBlockRef(still) })),
      ],
    },
    async execute(args: ReviewMotionArgs, exec) {
      const compositionDir = await localPath(ctx, exec, args.composition)
      const facts = await compositionFacts(compositionDir, args.composition)
      const times = reviewTimes(args, facts, config.maxReviewStills)
      // The review film stays inside the composition, where a renderer confined to the workspace can write it;
      // each review replaces it.
      const policy = sandboxPolicyOf(ctx, exec)
      const spec = ctx.motion.resolve({
        compositionDir,
        outputPath: join(compositionDir, 'renders', '.review.mp4'),
        quality: config.reviewQuality,
        stillTimes: times,
        ...policy === undefined ? {} : { sandboxPolicy: policy },
      })
      const review = await ctx.motion.render(spec, exec.signal)
      await recordRender(review, config.reviewQuality)
      const stills = await saveStills(ctx, basename(compositionDir), review.stills)
      return { path: args.composition, durationSeconds: review.durationSeconds, stills }
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
      const facts = await compositionFacts(compositionDir, args.composition)
      const policy = sandboxPolicyOf(ctx, exec)
      const spec = ctx.motion.resolve({
        compositionDir,
        outputPath,
        ...policy === undefined ? {} : { sandboxPolicy: policy },
        ...args.fps === undefined ? {} : { fps: args.fps as MotionFps },
        ...args.quality === undefined ? {} : { quality: args.quality as MotionQuality },
        ...args.stills === undefined ? {} : { stillTimes: spacedTimes(0, facts.durationSeconds, args.stills) },
      })
      const film = await ctx.motion.render(spec, exec.signal)
      await recordRender(film, spec.quality)
      const name = basename(film.outputPath)
      let video: FileAttachmentRef | undefined
      let storageError: string | undefined
      try {
        video = await ctx.attachments.saveFile({
          // Read through the filesystem service, which resolves the path the renderer reported before reading it.
          data: await ctx.fs.readBytes(
            await ctx.fs.resolve(film.outputPath, { signal: exec.signal }), exec.signal, Math.max(1, film.bytes),
          ),
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
