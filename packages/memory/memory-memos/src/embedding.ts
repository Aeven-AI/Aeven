/** One Host-owned embedding worker with bounded, round-robin account queues. */
import { Worker } from 'node:worker_threads'
import type { EmbedRole, EmbeddingProvider, ProviderCallCtx } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'

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

/** The queue bounds include the account's running request. */
export interface EmbeddingWorkerLimits {
  readonly perAccount: number
  readonly total: number
}

/** A lazy worker shared by all of the hosted deployment's account cores. */
export class HostedEmbeddings {
  private worker: Worker | undefined
  private active: Job | undefined
  private readonly queues = new Map<string, Job[]>()
  private readonly counts = new Map<string, number>()
  private count = 0
  private nextId = 0
  private failure: Error | undefined
  private closing: Promise<void> | undefined

  /** @param limits - Maximum unfinished requests per account and for the Host. */
  constructor(private readonly limits: EmbeddingWorkerLimits) {}

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
    if (context.signal?.aborted === true) return Promise.reject(context.signal.reason)
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

  private pump(): void {
    if (this.active !== undefined || this.failure !== undefined) return
    const next = this.queues.entries().next().value
    if (next === undefined) return
    const [owner, queue] = next
    const job = queue.shift()!
    this.queues.delete(owner)
    if (queue.length > 0) this.queues.set(owner, queue)
    this.active = job
    try {
      if (this.worker === undefined) {
        const source = new URL(import.meta.url).pathname.endsWith('.ts')
        this.worker = new Worker(new URL(source ? './embedding-worker.ts' : './embedding-worker.js', import.meta.url))
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
    if (job === undefined) return this.fail(new Error('Unexpected embedding response'))
    if (typeof message !== 'object' || message === null) return this.fail(new Error('Invalid embedding response'))
    const value = message as Record<string, unknown>
    if (value.id !== job.id) return this.fail(new Error('Embedding response identity mismatch'))
    if (typeof value.error === 'string') job.reject(new Error(value.error))
    else if (Array.isArray(value.vectors) && value.vectors.length === job.texts.length
      && value.vectors.every((row: unknown) => Array.isArray(row) && row.every((number: unknown) => typeof number === 'number' && Number.isFinite(number)))) {
      job.resolve(value.vectors as number[][])
    } else return this.fail(new Error('Invalid embedding vectors'))
    this.active = undefined
    this.release(job)
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
  }

  /**
   * Stop accepting requests, reject unfinished work, and join the worker's termination.
   * @returns completion after the worker exits.
   */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      this.fail(new Error('Hosted embeddings are shutting down'))
      await this.worker?.terminate()
    })()
  }
}
