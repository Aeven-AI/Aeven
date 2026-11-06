/**
 * A motion renderer for a Host that runs every model-written page inside the calling account's sandbox, such as
 * hosted Web. `bundle()` copies a composition folder through `ctx.fs` into one document the conversation's live
 * player plays; every file and directory must resolve inside the folder, so a symbolic link a command placed there
 * cannot pull another folder's files into the document. `render()` pipes that document into the sandbox's
 * `render-motion` command under the session's sandbox policy, which steps the composition's own player frame by
 * frame into an H.264 MP4 and returns the film's facts and stills.
 * @module @aeven/motion-sandbox
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FsTarget } from '@aeven/fs'
import type {} from '@aeven/fs'
import type { MotionQuality, MotionRenderInput, MotionRenderOutput, MotionRenderer } from '@aeven/motion'
import type {} from '@aeven/motion'
import type {} from '@aeven/shell'
import { bundleToSingleHtml } from '@hyperframes/core/compiler'

export const name = 'motion-sandbox'
/** The service the renderer registers into, the filesystem it reads compositions through, and the sandboxed shell it renders in. */
export const inject = ['motion', 'fs', 'shell']

/** Bounds on a bundle and on a render. */
export interface Config {
  /** Most files one composition folder may hold. */
  maxFiles: number
  /** Most bytes the folder's files may total. */
  maxBytes: number
  /** The sandbox command that renders a page to an MP4. */
  command: string
  /** How long one render may run, in milliseconds. */
  timeoutMs: number
  /** Most bytes of the command's JSON result, which carries the stills. */
  resultMaxBytes: number
  /** H.264 constant rate factor per quality tier; lower is sharper and larger. */
  crf: Record<MotionQuality, number>
  /** Pixel width of returned stills. */
  stillWidth: number
}

export const Config: z<Config> = z.object({
  maxFiles: z.natural().min(1).default(500),
  maxBytes: z.natural().min(1).default(64 * 1024 * 1024),
  command: z.string().default('render-motion'),
  timeoutMs: z.natural().min(1_000).default(10 * 60 * 1000),
  resultMaxBytes: z.natural().min(1_024).default(32 * 1024 * 1024),
  crf: z.object({
    draft: z.natural().max(51).default(30),
    standard: z.natural().max(51).default(23),
    high: z.natural().max(51).default(18),
  }),
  stillWidth: z.natural().min(64).default(960),
})

/** The command's JSON result. */
interface RenderResult {
  seconds: number
  width: number
  height: number
  encoder: string
  stills: { seconds: number; png: string }[]
}

/**
 * Quote one argument for POSIX `sh`.
 * @param value - the argument.
 * @returns the single-quoted argument.
 */
function quote(value: string): string {
  return `'${value.replaceAll('\'', '\'\\\'\'')}'`
}

/**
 * Copy the composition folder's regular files that resolve inside it into `scratch`.
 * @param ctx - context carrying `ctx.fs`.
 * @param root - the resolved composition folder.
 * @param scratch - private folder the files are written to at their relative paths.
 * @param config - file and byte bounds.
 * @throws When the folder holds more files or bytes than the bounds allow.
 */
async function copyFolder(ctx: Context, root: FsTarget, scratch: string, config: Config): Promise<void> {
  let files = 0
  let bytes = 0
  const visit = async (dir: FsTarget, relative: readonly string[]): Promise<void> => {
    for (const entry of await ctx.fs.listDir(dir)) {
      // A link out of the folder resolves outside it and is left out; `renders/` holds finished films.
      if (!ctx.fs.contains(root, entry.target) || (relative.length === 0 && entry.name === 'renders')) continue
      const path = [...relative, entry.name]
      if (entry.type === 'directory') {
        await visit(entry.target, path)
        continue
      }
      if (entry.type !== 'file') continue
      files += 1
      if (files > config.maxFiles) throw new Error(`the composition holds more than ${String(config.maxFiles)} files`)
      const data = await ctx.fs.readBytes(entry.target, undefined, config.maxBytes - bytes)
      bytes += data.byteLength
      const target = join(scratch, ...path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data, { flag: 'wx' })
    }
  }
  await visit(root, [])
}

/**
 * Bundle a composition folder into one self-contained document.
 * @param ctx - context carrying `ctx.fs`.
 * @param compositionDir - absolute folder holding `index.html`.
 * @param config - file and byte bounds.
 * @returns the document's HTML.
 */
async function bundle(ctx: Context, compositionDir: string, config: Config): Promise<string> {
  const root = await ctx.fs.resolve(compositionDir)
  const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-bundle-'))
  try {
    await copyFolder(ctx, root, scratch, config)
    return await bundleToSingleHtml(scratch, { runtime: 'inline' })
  } finally {
    await rm(scratch, { recursive: true, force: true })
  }
}

/**
 * Render one composition inside the calling account's sandbox.
 * @param ctx - context carrying `ctx.fs` and `ctx.shell`.
 * @param input - resolved render; its sandbox policy is required.
 * @param signal - cancellation.
 * @param config - render bounds.
 * @returns the written film.
 * @throws When the request carries no sandbox policy, a path leaves the policy's workspace, or the command fails.
 */
async function render(ctx: Context, input: MotionRenderInput, signal: AbortSignal, config: Config): Promise<MotionRenderOutput> {
  const policy = input.sandboxPolicy
  if (policy === undefined) throw new Error('rendering here needs the calling session\'s sandbox policy')
  const workspace = await ctx.fs.resolve(policy.workspaceRoot, { signal })
  const composition = await ctx.fs.resolve(input.compositionDir, { signal })
  const output = await ctx.fs.resolve(input.outputPath, { signal })
  for (const target of [composition, output]) {
    if (!ctx.fs.contains(workspace, target)) throw new Error(`${target.displayPath} is outside the workspace`)
  }
  const html = await bundle(ctx, composition.displayPath, config)
  const command = [
    `mkdir -p ${quote(dirname(output.displayPath))} &&`,
    config.command, '-', quote(output.displayPath),
    '--fps', String(input.fps), '--crf', String(config.crf[input.quality]),
    '--stills', String(input.stills), '--still-width', String(config.stillWidth), '--json',
  ].join(' ')
  const result = await ctx.shell.run(ctx.shell.resolve({
    command,
    workdir: composition.displayPath,
    timeoutMs: config.timeoutMs,
    stdoutMaxBytes: config.resultMaxBytes,
    stdin: html,
    sandboxPolicy: policy,
    signal,
  }))
  signal.throwIfAborted()
  if (result.timedOut) throw new Error(`the render ran longer than ${String(Math.round(config.timeoutMs / 1000))} s`)
  const line = result.stdout.text.trim().split('\n').pop() ?? ''
  if (result.exitCode !== 0 || result.stdout.truncated || !line.startsWith('{')) {
    const reason = result.stderr.text.trim().split('\n').slice(-3).join(' ')
    throw new Error(reason.length > 0 ? reason : `${config.command} exited with ${String(result.exitCode)}`)
  }
  const film = JSON.parse(line) as RenderResult
  const info = await ctx.fs.stat(output, signal)
  if (info?.type !== 'file') throw new Error(`${config.command} wrote no film at ${output.displayPath}`)
  return {
    outputPath: output.displayPath,
    bytes: info.size ?? 0,
    durationSeconds: film.seconds,
    width: film.width,
    height: film.height,
    encoder: film.encoder,
    stills: film.stills.map(still => ({ seconds: still.seconds, png: new Uint8Array(Buffer.from(still.png, 'base64')) })),
  }
}

/**
 * Register the sandboxed renderer.
 * @param ctx - context carrying `ctx.motion`, `ctx.fs`, and `ctx.shell`.
 * @param config - bundle and render bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const renderer: MotionRenderer = {
    name: 'sandbox',
    render: (input, signal) => render(ctx, input, signal, config),
    bundle: compositionDir => bundle(ctx, compositionDir, config),
  }
  ctx.effect(() => ctx.motion.register(renderer), 'motion-sandbox: renderer')
}
