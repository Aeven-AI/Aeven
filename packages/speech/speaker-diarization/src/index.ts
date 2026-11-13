/**
 * Local speaker diarization: splits a recording into stretches of one voice each and embeds every
 * stretch, so a caller can label speakers consistently across the recordings of one meeting.
 *
 * The models (pyannote segmentation 3.0 and a WeSpeaker ResNet34 voice embedding) are downloaded
 * on demand into `dataRoot`, size- and SHA-256-verified against `runtime/assets.json`. Inference
 * runs through the sherpa-onnx Node-API addon in one worker thread, started at the first request
 * after the models verify. Hosts without a sherpa-onnx build for their platform report
 * `unavailable` instead of failing.
 */
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, readFileSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Worker } from 'node:worker_threads'
import { Service, type Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Config } from './config.ts'
import type { DiarizationState, SpeakerSegment } from './types.ts'
import { WORKER_SOURCE } from './worker-source.ts'

export type { Config } from './config.ts'
export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Local speaker diarization. */
    speakerDiarization: SpeakerDiarization
  }
}

/** A pinned, verified download. */
interface Asset {
  readonly name: string
  readonly url: string
  readonly bytes: number
  readonly sha256: string
}

interface AssetLock {
  readonly segmentation: Asset
  readonly embedding: Asset
}

interface Pending {
  readonly resolve: (segments: SpeakerSegment[]) => void
  readonly reject: (error: Error) => void
}

const LOCK = JSON.parse(readFileSync(new URL('../runtime/assets.json', import.meta.url), 'utf8')) as AssetLock
const TOTAL_BYTES = LOCK.segmentation.bytes + LOCK.embedding.bytes

/**
 * Whether a file on disk is the pinned asset.
 * @param path - candidate file.
 * @param asset - pinned identity.
 * @returns true when size and SHA-256 match.
 */
async function matches(path: string, asset: Asset): Promise<boolean> {
  try {
    if ((await stat(path)).size !== asset.bytes) return false
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  const digest = createHash('sha256')
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer)
  return digest.digest('hex') === asset.sha256
}

/** The diarization capability: model preparation, readiness, and segmentation. */
export class SpeakerDiarization extends Service {
  /** Deployment configuration; see {@link Config}. */
  static Config: z<Partial<Config>, Config> = z.object({
    dataRoot: z.string().required(),
    threads: z.natural().min(1).default(2),
    clusteringThreshold: z.number().min(0).max(2).default(0.3),
    minDurationOn: z.number().min(0).default(0.3),
    minDurationOff: z.number().min(0).default(0.5),
    minEmbeddingSeconds: z.number().min(0.1).default(0.6),
    progressIntervalMs: z.natural().default(250),
  })
  private state: DiarizationState = { phase: 'checking' }
  private readonly listeners = new Set<() => void>()
  private preparing: Promise<void> | undefined
  private worker: Worker | undefined
  private starting: Promise<Worker> | undefined
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private readonly addon: string | undefined
  private readonly unavailableReason: string | undefined

  /**
   * @param ctx - Host context.
   * @param config - validated diarizer configuration.
   */
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'speakerDiarization')
    if (!isAbsolute(config.dataRoot)) throw new Error(`speaker-diarization: dataRoot must be absolute: ${config.dataRoot}`)
    try {
      this.addon = createRequire(import.meta.url).resolve('sherpa-onnx-node')
    } catch (error) {
      this.unavailableReason = `No speaker diarization runtime for ${process.platform}-${process.arch}: ${error instanceof Error ? error.message : String(error)}`
    }
    ctx.effect(() => () => { this.stopWorker(new Error('Speaker diarization stopped')) }, 'speaker-diarization: worker')
    void this.inspect()
  }

  /** Inspect the cache without downloading; a failed read reports `failed`, which `prepare` retries. */
  private async inspect(): Promise<void> {
    if (this.unavailableReason !== undefined) { this.set({ phase: 'unavailable', reason: this.unavailableReason }); return }
    try {
      const ready = await this.verified()
      if (this.preparing === undefined) this.set(ready ? { phase: 'ready' } : { phase: 'unprepared', totalBytes: TOTAL_BYTES })
    } catch (error) {
      this.set({ phase: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  /**
   * Read the diarizer's state without waiting.
   * @returns the current state.
   */
  snapshot(): DiarizationState { return this.state }

  /**
   * Follow the state until `signal` aborts.
   * @param signal - observation lifetime.
   * @returns the current state, then every change.
   */
  async *follow(signal: AbortSignal): AsyncIterable<DiarizationState> {
    let wake: (() => void) | undefined
    let changed = true
    const listener = (): void => { changed = true; wake?.() }
    const abort = (): void => { wake?.() }
    this.listeners.add(listener)
    signal.addEventListener('abort', abort, { once: true })
    try {
      while (!signal.aborted) {
        if (changed) { changed = false; yield this.state; continue }
        await new Promise<void>((resolve) => { wake = resolve })
        wake = undefined
      }
    } finally {
      this.listeners.delete(listener)
      signal.removeEventListener('abort', abort)
    }
  }

  /** Download and verify the models unless they are present; joins a running preparation. */
  prepare(): void {
    if (this.state.phase === 'unavailable' || this.state.phase === 'ready' || this.preparing !== undefined) return
    // An inspection still checking the cache is superseded: the download verifies every file itself.
    this.preparing = this.download()
      .then(() => { this.set({ phase: 'ready' }) })
      .catch((error: unknown) => { this.set({ phase: 'failed', message: error instanceof Error ? error.message : String(error) }) })
      .finally(() => { this.preparing = undefined })
  }

  /**
   * Split one recording by voice.
   * @param samples - 16 kHz mono samples in [-1, 1]; transferred to the worker.
   * @param signal - caller cancellation.
   * @returns stretches tiling the recording, in order.
   */
  async segment(samples: Float32Array, signal: AbortSignal): Promise<SpeakerSegment[]> {
    signal.throwIfAborted()
    if (this.state.phase !== 'ready') throw new Error(`Speaker diarization is not ready (${this.state.phase})`)
    const worker = await this.ensureWorker()
    signal.throwIfAborted()
    const id = this.nextId++
    return await new Promise<SpeakerSegment[]>((resolve, reject) => {
      const onAbort = (): void => { this.pending.delete(id); reject(signal.reason as Error) }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (segments) => { signal.removeEventListener('abort', onAbort); resolve(segments) },
        reject: (error) => { signal.removeEventListener('abort', onAbort); reject(error) },
      })
      worker.postMessage({ id, samples }, [samples.buffer as ArrayBuffer])
    })
  }

  private async verified(): Promise<boolean> {
    this.set({ phase: 'checking' })
    for (const asset of [LOCK.segmentation, LOCK.embedding]) {
      if (!await matches(join(this.config.dataRoot, asset.name), asset)) return false
    }
    return true
  }

  private async download(): Promise<void> {
    await mkdir(this.config.dataRoot, { recursive: true })
    let done = 0
    let lastReport = 0
    const report = (completed: number, force = false): void => {
      const now = Date.now()
      if (!force && now - lastReport < this.config.progressIntervalMs) return
      lastReport = now
      this.set({ phase: 'downloading', completedBytes: completed, totalBytes: TOTAL_BYTES })
    }
    report(0, true)
    for (const asset of [LOCK.segmentation, LOCK.embedding]) {
      const destination = join(this.config.dataRoot, asset.name)
      if (await matches(destination, asset)) { done += asset.bytes; report(done, true); continue }
      const partial = `${destination}.${randomUUID()}.part`
      try {
        const response = await fetch(asset.url)
        if (!response.ok || response.body === null) throw new Error(`Downloading ${asset.name} failed: HTTP ${String(response.status)}`)
        const digest = createHash('sha256')
        let received = 0
        const base = done
        const counting = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            received += chunk.length
            if (received > asset.bytes) { callback(new Error(`Downloading ${asset.name} failed: larger than expected`)); return }
            digest.update(chunk)
            report(base + received)
            callback(null, chunk)
          },
        })
        await pipeline(response.body, counting, createWriteStream(partial, { flags: 'wx', mode: 0o600 }))
        if (received !== asset.bytes || digest.digest('hex') !== asset.sha256) throw new Error(`Downloading ${asset.name} failed: integrity check`)
        await rename(partial, destination)
        done += asset.bytes
        report(done, true)
      } finally {
        await rm(partial, { force: true })
      }
    }
    this.set({ phase: 'checking' })
    if (!await this.verified()) throw new Error('Speaker diarization models failed verification')
  }

  private async ensureWorker(): Promise<Worker> {
    if (this.worker !== undefined) return this.worker
    this.starting ??= new Promise<Worker>((resolve, reject) => {
      const worker = new Worker(WORKER_SOURCE, {
        eval: true,
        workerData: {
          addon: this.addon,
          segmentation: join(this.config.dataRoot, LOCK.segmentation.name),
          embedding: join(this.config.dataRoot, LOCK.embedding.name),
          options: {
            threads: this.config.threads,
            clusteringThreshold: this.config.clusteringThreshold,
            minDurationOn: this.config.minDurationOn,
            minDurationOff: this.config.minDurationOff,
            minEmbeddingSeconds: this.config.minEmbeddingSeconds,
          },
        },
      })
      worker.on('message', (message: { ready?: number; id?: number; segments?: SpeakerSegment[]; error?: string }) => {
        if (message.ready !== undefined) { this.worker = worker; resolve(worker); return }
        if (message.id === undefined) return
        const pending = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error !== undefined) pending?.reject(new Error(message.error))
        else pending?.resolve(message.segments ?? [])
      })
      worker.on('error', (error) => { reject(error); this.stopWorker(error) })
      worker.on('exit', () => { if (this.worker === worker) this.stopWorker(new Error('Speaker diarization worker exited')) })
    })
    try { return await this.starting } finally { this.starting = undefined }
  }

  private stopWorker(error: Error): void {
    const worker = this.worker
    this.worker = undefined
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    if (worker !== undefined) void worker.terminate()
  }

  private set(state: DiarizationState): void {
    this.state = state
    for (const listener of this.listeners) listener()
  }
}

export default SpeakerDiarization
