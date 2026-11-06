/** Locate the ffmpeg and ffprobe executables HyperFrames encodes and probes with. @module */
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/** The two executables a render needs. */
export interface FfBinaries {
  readonly ffmpeg: string
  readonly ffprobe: string
}

/**
 * Resolve each executable from its configured path, else from the bundled `@aeven/ffmpeg-<platform>-<arch>`
 * package installed for this host.
 * @param configured - explicit paths from the plugin config.
 * @returns absolute paths of both executables.
 * @throws When an executable has no configured path and no bundled copy, or a resolved path does not exist.
 */
export function resolveFfBinaries(configured: { ffmpegPath?: string | undefined; ffprobePath?: string | undefined }): FfBinaries {
  const suffix = process.platform === 'win32' ? '.exe' : ''
  let bundled: string | undefined
  try {
    const manifest = createRequire(import.meta.url).resolve(`@aeven/ffmpeg-${process.platform}-${process.arch}/package.json`)
    bundled = join(dirname(manifest), 'bin')
  } catch {
    // A host whose platform package is not installed has no bundled executables; configured paths still apply.
  }
  const pick = (name: 'ffmpeg' | 'ffprobe', explicit: string | undefined): string => {
    const path = explicit ?? (bundled === undefined ? undefined : join(bundled, `${name}${suffix}`))
    if (path === undefined) {
      throw new Error(`motion-hyperframes: no bundled ${name} for ${process.platform}-${process.arch}; set ${name}Path`)
    }
    if (!existsSync(path)) throw new Error(`motion-hyperframes: ${name} not found at ${path}`)
    return path
  }
  return { ffmpeg: pick('ffmpeg', configured.ffmpegPath), ffprobe: pick('ffprobe', configured.ffprobePath) }
}
