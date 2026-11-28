/** One Host-owned embedding worker with bounded, round-robin account queues. */
import { Worker } from 'node:worker_threads'
import type { EmbedRole, EmbeddingProvider, ProviderCallCtx } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'

/** The rejection reason a cancelled embedding request settles with. */
function cancelled(reason: unknown): Error {
  if (reason instanceof Error) return reason
  return new Error(typeof reason === 'string' ? reason : 'Embedding request cancelled')
}

interface Job {
  id: number
  owner: string
  texts: string[]
  role: EmbedRole
  context: ProviderCallCtx
  resolve: (vectors: number[][]) => void
  reject: (error: unknown) => void
  detach: () => void
}

/** The queue key of the warm-up request, which no account id can equal. */
const WARM_OWNER = '\0warm'

/** The queue bounds include the account's running request. */
export interface EmbeddingWorkerLimits {
  readonly perAccount: number
  readonly total: number
}

/** One worker thread, started by its first request, that embeds for every account core of the Host. */
export class HostedEmbeddings {
  private worker: Worker | undefined
  private active: Job | undefined
  private readonly queues = new Map<string, Job[]>()
  private readonly counts = new Map<string, number>()
  private count = 0
  private nextId = 0
  private failure: Error | undefined
  private closing: Promise<void> | undefined
  /** Resolves `close()`'s wait once the running job has settled; set only while it waits. */
  private settled: (() => void) | undefined

  /** @param limits - Maximum unfinished requests per account and for the Host. */
  constructor(private readonly limits: EmbeddingWorkerLimits) {}

  /**
   * Load the model into the worker before any account asks for an embedding: a cold worker spends longer loading
   * it than a turn's recall waits, so the first turn after a start would otherwise recall nothing.
   * @param model - the embedding model id.
   * @param device - the transformers.js execution device.
   * @param dtype - the transformers.js weight precision.
   * @returns when the model answered once, or failed to.
   */
  warm(model: string, device: string, dtype: string): Promise<void> {
    const context = { config: { provider: 'local', model, device, dtype } } as unknown as ProviderCallCtx
    return this.embed(WARM_OWNER, ['warm'], 'query', context).then(() => undefined, () => undefined)
  }

  /**
   * Bind embedding requests to one account without giving its core ownership of the shared worker.
   * @param owner - account whose core is being opened.
   * @returns MemOS's local-provider implementation for that account.
   */
  forOwner(owner: string): EmbeddingProvider {
    return { name: 'local', embed: (texts, role, context) => this.embed(owner, texts, role, context) }
  }

  private embed(owner: string, texts: string[], role: EmbedRole, context: ProviderCallCtx): Promise<number[][]> {
    if (this.failure !== undefined) return Promise.reject(this.failure)
    if (this.closing !== undefined) return Promise.reject(new Error('Hosted embeddings are shutting down'))
    if (context.signal?.aborted === true) return Promise.reject(cancelled(context.signal.reason))
    if (this.count >= this.limits.total || (this.counts.get(owner) ?? 0) >= this.limits.perAccount) {
      return Promise.reject(new Error('Hosted embedding queue is full'))
    }
    return new Promise((resolve, reject) => {
      const job: Job = { id: ++this.nextId, owner, texts: [...texts], role, context, resolve, reject, detach: () => {} }
      const abort = (): void => {
        job.reject(context.signal?.reason)
        job.detach()
        if (this.active === job) return
        const queue = this.queues.get(owner)
        const index = queue?.indexOf(job) ?? -1
        if (index < 0 || queue === undefined) return
        queue.splice(index, 1)
        if (queue.length === 0) this.queues.delete(owner)
        this.release(job)
      }
      job.detach = () => { context.signal?.removeEventListener('abort', abort) }
      context.signal?.addEventListener('abort', abort, { once: true })
      const queue = this.queues.get(owner) ?? []
      queue.push(job)
      this.queues.set(owner, queue)
      this.count++
      this.counts.set(owner, (this.counts.get(owner) ?? 0) + 1)
      this.pump()
    })
  }

  /**
   * Take the next job: the oldest query embedding of the first account that has one, otherwise the head of the first
   * account's queue. A query is a recall the turn waits for, so it waits for at most the running job rather than for
   * capture and re-index batches queued before it; the account served moves to the back of the rotation.
   * @returns the job to run, or undefined when every queue is empty.
   */
  private take(): Job | undefined {
    let chosen: [string, Job[], number] | undefined
    for (const [owner, queue] of this.queues) {
      const index = queue.findIndex(job => job.role === 'query')
      if (index >= 0) { chosen = [owner, queue, index]; break }
    }
    if (chosen === undefined) {
      const first = this.queues.entries().next().value
      if (first === undefined) return undefined
      chosen = [first[0], first[1], 0]
    }
    const [owner, queue, index] = chosen
    const [job] = queue.splice(index, 1)
    this.queues.delete(owner)
    if (queue.length > 0) this.queues.set(owner, queue)
    return job
  }

  private pump(): void {
    if (this.active !== undefined || this.failure !== undefined) return
    const job = this.take()
    if (job === undefined) return
    this.active = job
    try {
      if (this.worker === undefined) {
        const source = new URL(import.meta.url).pathname.endsWith('.ts')
        this.worker = new Worker(new URL(source ? './worker.ts' : './worker.js', import.meta.url))
        this.worker.on('message', (message: unknown) => { this.complete(message) })
        this.worker.on('error', (error) => { this.fail(error) })
        this.worker.on('exit', (code) => { this.fail(new Error(`Hosted embedding worker exited (${code})`)) })
      }
      const { model, device = 'cpu', dtype = 'q8' } = job.context.config
      this.worker.postMessage({ id: job.id, texts: job.texts, role: job.role, model, device, dtype })
    } catch (error) {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private complete(message: unknown): void {
    const job = this.active
    if (job === undefined) { this.fail(new Error('Unexpected embedding response')); return }
    if (typeof message !== 'object' || message === null) { this.fail(new Error('Invalid embedding response')); return }
    const value = message as Record<string, unknown>
    if (value.id !== job.id) { this.fail(new Error('Embedding response identity mismatch')); return }
    if (typeof value.error === 'string') job.reject(new Error(value.error))
    else if (Array.isArray(value.vectors) && value.vectors.length === job.texts.length
      && value.vectors.every((row: unknown) => Array.isArray(row) && row.every((number: unknown) => typeof number === 'number' && Number.isFinite(number)))) {
      job.resolve(value.vectors as number[][])
    } else { this.fail(new Error('Invalid embedding vectors')); return }
    this.active = undefined
    this.release(job)
    this.settled?.()
    this.pump()
  }

  private release(job: Job): void {
    job.detach()
    this.count--
    const count = (this.counts.get(job.owner) ?? 1) - 1
    if (count === 0) this.counts.delete(job.owner)
    else this.counts.set(job.owner, count)
  }

  private fail(error: Error): void {
    if (this.failure !== undefined) return
    this.failure = error
    const jobs = [...this.queues.values()].flat()
    if (this.active !== undefined) jobs.push(this.active)
    this.active = undefined
    this.queues.clear()
    for (const job of jobs) { job.reject(error); this.release(job) }
    this.settled?.()
  }

  /**
   * Stop accepting requests, reject queued work, let the running request settle, then join the worker's termination.
   *
   * The running request may be inside onnxruntime, including the model load the warm-up starts. Terminating the worker
   * then makes onnxruntime raise an error into a stopping JavaScript environment, which aborts the whole process.
   * Waiting therefore lasts as long as that one request: a model load or one embedding batch.
   * @returns completion after the worker exits.
   */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      const error = new Error('Hosted embeddings are shutting down')
      const queued = [...this.queues.values()].flat()
      this.queues.clear()
      for (const job of queued) { job.reject(error); this.release(job) }
      if (this.active !== undefined && this.failure === undefined) {
        // `embed()` refuses new work while closing, so `pump()` after this job finds nothing and leaves the worker idle.
        await new Promise<void>((resolve) => { this.settled = resolve })
        this.settled = undefined
      }
      this.fail(error)
      await this.worker?.terminate()
    })()
  }
}
