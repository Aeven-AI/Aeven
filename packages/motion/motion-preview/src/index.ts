/**
 * A motion renderer for Hosts that must not run a browser over model-written pages, such as hosted Web: it bundles
 * a composition folder into one document the conversation's live player plays, and renders no films. The folder is
 * read through `ctx.fs`; every file and directory must resolve inside it, so a symbolic link a command placed there
 * cannot pull another folder's files into the document.
 * @module @aeven/motion-preview
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { FsTarget } from '@aeven/fs'
import type {} from '@aeven/fs'
import type { MotionRenderer } from '@aeven/motion'
import type {} from '@aeven/motion'
import { bundleToSingleHtml } from '@hyperframes/core/compiler'

export const name = 'motion-preview'
/** The service the renderer registers into, and the filesystem it reads compositions through. */
export const inject = ['motion', 'fs']

/** Bounds on the folder one bundle reads. */
export interface Config {
  /** Most files one composition folder may hold. */
  maxFiles: number
  /** Most bytes the folder's files may total. */
  maxBytes: number
}

export const Config: z<Config> = z.object({
  maxFiles: z.natural().min(1).default(500),
  maxBytes: z.natural().min(1).default(64 * 1024 * 1024),
})

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
 * Register the bundling renderer.
 * @param ctx - context carrying `ctx.motion` and `ctx.fs`.
 * @param config - file and byte bounds.
 */
export function apply(ctx: Context, config: Config): void {
  const renderer: MotionRenderer = {
    name: 'preview',
    render: () => Promise.reject(new Error('This Host shows motion films live and renders none to MP4')),
    async bundle(compositionDir) {
      const root = await ctx.fs.resolve(compositionDir)
      const scratch = await mkdtemp(join(tmpdir(), 'avn-motion-preview-'))
      try {
        await copyFolder(ctx, root, scratch, config)
        return await bundleToSingleHtml(scratch, { runtime: 'inline' })
      } finally {
        await rm(scratch, { recursive: true, force: true })
      }
    },
  }
  ctx.effect(() => ctx.motion.register(renderer), 'motion-preview: renderer')
}
