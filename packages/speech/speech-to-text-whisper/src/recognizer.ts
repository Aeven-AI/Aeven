/** One serial Whisper worker with request-owned cancellation and idle reclamation. */
import { mkdir } from 'node:fs/promises'
import type { Readable } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle } from '@aeven/subprocess'
import type { SpeechPreparationOptions, SpeechInput, SpeechPreparationState, SpeechPreparationStep, SpeechPreparationStepKind, Transcript } from '@aeven/speech-to-text/types'
import { deadline } from '@aeven/timeout'
import { z } from 'zod'
import type { Config } from './config.ts'
import { encodeRequest, SpeechInputError, validateInput } from './input.ts'
import { SpeechDownloadError } from './download-error.ts'
import { inspectRuntime, prepareRuntime, type RuntimePaths } from './runtime.ts'

const readySchema = z.object({ ready: z.literal(true) }).strict()
const replySchema = z.union([
  z.object({ text: z.string(), inferenceSeconds: z.number().nonnegative() }).strict(),
  z.object({ error: z.string(), code: z.string() }).strict(),
])

interface Worker {
  readonly handle: SubprocessHandle
  readonly lines: LineReader
  closed: boolean
}

/** Wait for a cancellable operation without losing ownership of its eventual settlement. */
function waitFor<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const abort = (): void => { reject(signal.reason instanceof Error ? signal.reason : new Error('Speech operation cancelled')) }
    signal.addEventListener('abort', abort, { once: true })
    void pending.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort) })
  })
}

/** Newline-delimited reader over the worker's stdout; a line beyond `limit` bytes or an early exit fails every reader. */
export class LineReader {
  private buffer = ''
  private readonly lines: string[] = []
  private waiting: PromiseWithResolvers<string> | undefined
  private failure: Error | undefined

  /**
   * @param stdout - the worker's raw stdout.
   * @param limit - maximum bytes of one line.
   * @param exited - settles when the worker exits; describes the exit for pending readers.
   */
  constructor(stdout: Readable, private readonly limit: number, exited: Promise<string>) {
    stdout.setEncoding('utf8')
    stdout.on('data', (chunk: string) => { this.push(chunk) })
    stdout.on('error', (error: Error) => { this.fail(error) })
    void exited.then((detail) => { this.fail(new Error(`Speech worker exited: ${detail}`)) })
  }

  private push(chunk: string): void {
    this.buffer += chunk
    for (let end = this.buffer.indexOf('\n'); end >= 0; end = this.buffer.indexOf('\n')) {
      this.lines.push(this.buffer.slice(0, end))
      this.buffer = this.buffer.slice(end + 1)
    }
    if (Buffer.byteLength(this.buffer) > this.limit) { this.fail(new Error('Speech worker output exceeded its byte limit')); return }
    this.deliver()
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.waiting?.reject(this.failure)
    this.waiting = undefined
  }

  private deliver(): void {
    const line = this.lines.shift()
    if (line === undefined || this.waiting === undefined) { if (line !== undefined) this.lines.unshift(line); return }
    if (Buffer.byteLength(line) > this.limit) { this.fail(new Error('Speech worker output exceeded its byte limit')); return }
    this.waiting.resolve(line)
    this.waiting = undefined
  }

  /**
   * Read the next complete line.
   * @param signal - deadline or caller cancellation.
   * @returns the line without its newline.
   */
  async next(signal: AbortSignal): Promise<string> {
    if (this.lines.length === 0 && this.failure !== undefined) throw this.failure
    if (this.waiting !== undefined) throw new Error('Speech worker lines are read one request at a time')
    this.waiting = Promise.withResolvers<string>()
    const line = this.waiting.promise
    this.deliver()
    return await waitFor(line, signal)
  }
}

/**
 * Decode one worker reply line.
 * @param line - JSON reply for one request.
 * @param audioSeconds - validated duration of the submitted recording.
 * @returns the final transcript; an `invalid-input` reply throws SpeechInputError and any other error reply throws.
 */
export function parseReply(line: string, audioSeconds: number): Transcript {
  const reply = replySchema.parse(JSON.parse(line))
  if ('error' in reply) {
    if (reply.code === 'invalid-input') throw new SpeechInputError(reply.error)
    throw new Error(reply.error)
  }
  return { text: reply.text, audioSeconds, inferenceSeconds: reply.inferenceSeconds }
}

/** Own one worker across recordings, and join every accepted job on disposal. */
export class WhisperWorker {
  private worker: Worker | undefined
  private tail: Promise<void> = Promise.resolve()
  private pending = 0
  private readonly lifetime = new AbortController()
  private idle: ReturnType<typeof setTimeout> | undefined
  private runtime: RuntimePaths | undefined
  private state: SpeechPreparationState & { readonly steps: readonly SpeechPreparationStep[] }
  private readonly listeners = new Set<() => void>()
  private lastProgressAt = 0
  /** Configured origins available for explicit downloads; offline deployments expose no choices. */
  readonly downloadSources: readonly string[]
  private preparing: { abort: AbortController; settled: Promise<void>; completed: boolean; downloadSource: string | undefined } | undefined

  constructor(private readonly ctx: Context, private readonly config: Config) {
    this.downloadSources = config.modelPath !== undefined && config.vadModelPath !== undefined ? []
      : [...new Set((config.modelOrigin === undefined ? config.modelOrigins : [config.modelOrigin]).map(origin => new URL(origin).origin))]
    const kinds: SpeechPreparationStepKind[] = ['check']
    if (config.modelPath === undefined) kinds.push('model')
    if (config.vadModelPath === undefined) kinds.push('vad')
    kinds.push('verify', 'load')
    this.state = { phase: 'unprepared', steps: kinds.map(kind => ({ kind, status: 'pending' })) }
  }

  /**
   * Read preparation readiness.
   * @returns the current Host-owned state.
   */
  snapshot(): SpeechPreparationState { return this.state }

  /**
   * Observe readiness.
   * @param listener - invalidation callback.
   * @returns subscription disposer.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private publish(state: SpeechPreparationState): void {
    if (this.preparing && ['ready', 'standby', 'unprepared', 'failed', 'cancelled'].includes(state.phase)) {
      this.preparing.completed = true
    }
    const previous = this.state
    const steps = state.steps ?? previous.steps.map((item): SpeechPreparationStep => {
      if (state.phase === 'ready') return { ...item, status: 'complete' }
      if (state.step === 'check' && item.kind !== 'check') return { kind: item.kind, status: 'pending' }
      if (state.step === item.kind) return item.status === 'running' ? item
        : { kind: item.kind, status: 'running', startedAt: Date.now() }
      if (item.status !== 'running') return item
      if (state.phase === 'standby') return { ...item, status: 'cancelled' }
      if (state.phase === 'failed' || state.phase === 'cancelled') return { ...item, status: state.phase }
      return state.step === undefined ? item : { ...item, status: 'complete' }
    })
    this.state = { ...state, steps }
    const now = performance.now()
    if (state.phase === 'downloading' && previous.phase === 'downloading' && state.resource === previous.resource
      && state.completedBytes !== state.totalBytes && now - this.lastProgressAt < this.config.progressIntervalMs) return
    this.lastProgressAt = now
    for (const listener of this.listeners) listener()
  }

  /** Inspect disk caches on activation; valid resources enter standby without starting a worker. */
  inspect(): void {
    this.runPreparation(async (signal) => {
      using inspection = deadline(signal, this.config.prepareTimeoutMs, 'SPEECH_PREPARE_TIMEOUT')
      this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() })
      const runtime = await inspectRuntime(this.config, inspection.signal)
      inspection.signal.throwIfAborted()
      this.runtime = runtime
      this.publish({ phase: runtime ? 'standby' : 'unprepared', steps: this.state.steps.map(({ kind }) => ({ kind,
        status: kind === 'check' || runtime && kind !== 'load' ? 'complete' : 'pending',
      })) })
    })
  }

  /**
   * Start or join one Host-owned preparation task with a fixed download source.
   * @param options - omitted source uses deployment policy; a manual source must be advertised and disables fallback.
   */
  prepare(options: SpeechPreparationOptions = {}): void {
    const source = options.downloadSource
    if (source !== undefined && !this.downloadSources.includes(source)) throw new Error('Speech download source is unavailable')
    const config = source === undefined ? this.config : Object.assign({}, this.config, { modelOrigin: source })
    this.runPreparation(async (signal) => { await this.start(signal, config) }, source)
  }

  private runPreparation(run: (signal: AbortSignal) => Promise<void>, downloadSource?: string): void {
    if (this.preparing && this.preparing.downloadSource !== downloadSource) throw new Error('Cancel preparation before changing its download source')
    if (this.preparing || this.worker) return
    this.lifetime.signal.throwIfAborted()
    const abort = new AbortController()
    const task = { abort, settled: Promise.resolve(), completed: false, downloadSource }
    this.preparing = task
    task.settled = this.enqueue(run, abort.signal)
      .catch((error: unknown) => {
        if (this.lifetime.signal.aborted) return
        this.publish(abort.signal.aborted ? { phase: 'cancelled' }
          : { phase: 'failed', message: error instanceof Error ? error.message : String(error),
            ...error instanceof SpeechDownloadError ? { download: error.download } : {} })
      }).finally(() => { this.preparing = undefined })
  }

  /** Cancel unfinished preparation; completed readiness is retained. @returns after its queued or active work settles. */
  async cancel(): Promise<void> {
    const task = this.preparing
    if (!task) return
    if (!task.completed) {
      this.publish({ phase: 'cancelling', startedAt: Date.now() })
      task.abort.abort(new Error('Speech preparation cancelled'))
    }
    await task.settled
  }

  /**
   * Queue one bounded recording; cancellation never leaves inference running after settlement.
   * Verified resources accept recordings while the worker wakes; other preparation states reject without downloading.
   * @param input - complete WAV and language hint.
   * @param signal - caller cancellation.
   * @returns recognized text; cancelled waiting jobs never acquire the worker.
   */
  async transcribe(input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
    return await this.enqueue(async combined => await this.execute(input, combined), signal)
  }

  private async enqueue<T>(run: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    const combined = AbortSignal.any([signal, this.lifetime.signal])
    combined.throwIfAborted()
    if (this.pending >= this.config.maxPending) throw new Error('Speech transcription queue is full')
    clearTimeout(this.idle)
    this.pending++
    const job = this.tail.then(async () => {
      combined.throwIfAborted()
      return await run(combined)
    })
    this.tail = job.then(() => undefined, () => undefined).finally(() => {
      this.pending--
      if (this.pending === 0 && !this.lifetime.signal.aborted && this.config.idleTimeoutMs > 0) {
        this.idle = setTimeout(() => {
          this.tail = this.tail.then(async () => { await this.stop() })
          void this.tail.catch((error: unknown) => { this.ctx.logger.warn('Speech worker idle cleanup failed', error) })
        }, this.config.idleTimeoutMs)
      }
    })
    return await job
  }

  private async start(signal: AbortSignal, preparationConfig: Config = this.config): Promise<Worker> {
    if (this.worker?.closed) await this.stop()
    if (this.worker) return this.worker
    using setup = deadline(signal, this.config.prepareTimeoutMs, 'SPEECH_PREPARE_TIMEOUT')
    const cached = this.runtime !== undefined
    if (!cached) this.publish({ phase: 'checking', step: 'check', startedAt: Date.now() })
    const runtime = this.runtime ?? await prepareRuntime(preparationConfig, setup.signal, (state) => { this.publish(state) })
    this.runtime = runtime
    setup.signal.throwIfAborted()
    this.publish({ phase: cached ? 'waking' : 'loading', step: 'load', startedAt: Date.now() })
    await mkdir(this.config.dataRoot, { recursive: true })
    const config = this.config
    const handle = this.ctx.subprocess.spawn({
      argv: [runtime.worker, '--model', runtime.model, '--vad-model', runtime.vad,
        '--threads', String(config.threads), '--max-samples', String(Math.floor((config.maxAudioBytes - 44) / 2)),
        '--vad-threshold', String(config.vadThreshold), '--vad-min-speech-ms', String(config.vadMinSpeechMs),
        '--vad-min-silence-ms', String(config.vadMinSilenceMs), '--vad-pad-ms', String(config.vadSpeechPadMs)],
      cwd: config.dataRoot, graceMs: config.graceMs,
      stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: config.maxLogBytes } },
    })
    const exited = handle.done.then(outcome => `${JSON.stringify(outcome)} ${handle.collected.stderr?.readFrom(0).text ?? ''}`.trim(),
      (error: unknown) => String(error))
    try {
      if (!handle.stdout || !handle.stdin) throw new Error('Speech worker stdio is unavailable')
      const lines = new LineReader(handle.stdout, config.maxResponseBytes, exited)
      readySchema.parse(JSON.parse(await lines.next(setup.signal)))
      const worker: Worker = { handle, lines, closed: false }
      this.worker = worker
      this.publish({ phase: 'ready' })
      const closed = (): void => {
        if (!worker.closed) { worker.closed = true; this.publish({ phase: 'standby' }) }
      }
      void handle.done.then(closed, closed)
      return worker
    } catch (error) {
      handle.terminate()
      await handle.waitForExit()
      throw error
    }
  }

  private async execute(input: SpeechInput, signal: AbortSignal): Promise<Transcript> {
    const phase = this.state.phase
    if (phase !== 'ready' && phase !== 'standby') throw new Error('Prepare the local speech provider before recording')
    const { audioSeconds, pcm } = validateInput(input.audio, input.language, this.config.maxAudioBytes)
    try {
      const worker = await this.start(signal)
      using call = deadline(signal, this.config.inferenceTimeoutMs, 'SPEECH_INFERENCE_TIMEOUT')
      worker.handle.stdin!.write(encodeRequest(input.language, pcm))
      const result = parseReply(await worker.lines.next(call.signal), audioSeconds)
      call.signal.throwIfAborted()
      return result
    } catch (error) {
      if (error instanceof SpeechInputError) throw error
      await this.stop()
      this.publish({ phase: 'standby' })
      throw error
    }
  }

  private async stop(): Promise<void> {
    const worker = this.worker
    if (!worker) return
    worker.closed = true
    worker.handle.stdin?.end()
    worker.handle.terminate()
    await worker.handle.waitForExit()
    this.worker = undefined
    this.publish({ phase: 'standby' })
  }

  /** Stop the local recognizer. @returns after admission closes, queued jobs settle, and the managed worker exits. */
  async dispose(): Promise<void> {
    this.listeners.clear()
    this.lifetime.abort(new Error('Whisper provider disposed'))
    clearTimeout(this.idle)
    try { await this.tail } finally { await this.stop() }
    await this.preparing?.settled
  }
}
