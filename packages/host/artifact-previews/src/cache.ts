/**
 * The disk cache of card pictures: one WebP per file version, or a marker recording that the version has no
 * picture, so each version is drawn once. Concurrent requests for one version share a single drawing.
 * @module @aeven/host-artifact-previews/cache
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/** What the cache holds for one version: its picture, or the fact that it has none. */
export type CachedPreview = Uint8Array | 'none'

/**
 * The cache key of one file version and picture setting.
 * @param parts - everything that changes the picture: the renderer, the file's identity and freshness, the size.
 * @returns a hex SHA-256 digest.
 */
export function previewKey(parts: readonly (string | number)[]): string {
  return createHash('sha256').update(parts.join('\u0000')).digest('hex')
}

/** Disk cache under one directory, fanned out by the key's first two characters. */
export class PreviewCache {
  private readonly drawing = new Map<string, Promise<CachedPreview>>()

  /** @param root - the cache directory; created on the first write. */
  constructor(private readonly root: string) {}

  /**
   * The cached picture of a version, drawing it once when absent. A drawing that throws is not recorded, so the
   * next request tries again; one that answers `none` is.
   * @param key - the version's key.
   * @param draw - draws the picture, or answers `none` when the version has none.
   * @returns the picture, or `none`.
   */
  async get(key: string, draw: () => Promise<CachedPreview>): Promise<CachedPreview> {
    const cached = await this.read(key)
    if (cached !== undefined) return cached
    const running = this.drawing.get(key)
    if (running !== undefined) return await running
    const pending = (async () => {
      const drawn = await draw()
      await this.write(key, drawn)
      return drawn
    })()
    this.drawing.set(key, pending)
    try {
      return await pending
    } finally {
      this.drawing.delete(key)
    }
  }

  private pathOf(key: string, kind: 'webp' | 'none'): string {
    return join(this.root, key.slice(0, 2), `${key}.${kind}`)
  }

  private async read(key: string): Promise<CachedPreview | undefined> {
    try {
      return new Uint8Array(await readFile(this.pathOf(key, 'webp')))
    } catch {
      // No picture on disk for this version yet; the marker below may still record that it has none.
    }
    try {
      await readFile(this.pathOf(key, 'none'))
      return 'none'
    } catch {
      // Neither the picture nor the marker: the version has not been drawn.
      return undefined
    }
  }

  /** Write through a temporary name, so a reader never sees half a picture. */
  private async write(key: string, value: CachedPreview): Promise<void> {
    const target = this.pathOf(key, value === 'none' ? 'none' : 'webp')
    await mkdir(join(this.root, key.slice(0, 2)), { recursive: true })
    const temporary = `${target}.${randomUUID()}.tmp`
    await writeFile(temporary, value === 'none' ? '' : value)
    await rename(temporary, target)
  }
}

/** At most `limit` drawings at once; the rest wait their turn in arrival order. */
export class DrawingQueue {
  private running = 0
  private readonly waiting: Array<() => void> = []

  /** @param limit - the most drawings that run together. */
  constructor(private readonly limit: number) {}

  /**
   * Run one drawing when a slot is free.
   * @param work - the drawing.
   * @returns its result.
   */
  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.running >= this.limit) await new Promise<void>((resolve) => { this.waiting.push(resolve) })
    this.running += 1
    try {
      return await work()
    } finally {
      this.running -= 1
      this.waiting.shift()?.()
    }
  }
}
