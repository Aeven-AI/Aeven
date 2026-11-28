/** Closing the Host's embedding worker: queued work is refused at once, the running request finishes before termination. */
import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProviderCallCtx } from '@deepseek-ai/memos-local-plugin/core/embedding/types.js'

/** Stand-in for the embedding worker thread: records requests and terminations, answers when the test says so. */
class FakeWorker extends EventEmitter {
  static instances: FakeWorker[] = []
  readonly requests: { id: number; texts: string[] }[] = []
  terminated = 0

  constructor() {
    super()
    FakeWorker.instances.push(this)
  }

  postMessage(message: { id: number; texts: string[] }): void {
    this.requests.push(message)
  }

  terminate(): Promise<number> {
    this.terminated++
    return Promise.resolve(0)
  }

  /** Answer the request `id` with one vector per text. */
  answer(id: number): void {
    const request = this.requests.find(entry => entry.id === id)
    if (request === undefined) throw new Error(`no request ${String(id)}`)
    this.emit('message', { id, vectors: request.texts.map(() => [1, 0]) })
  }
}

vi.mock('node:worker_threads', () => ({ Worker: FakeWorker }))

const { HostedEmbeddings } = await import('../src/embedding.ts')

const context = { config: { provider: 'local', model: 'm', device: 'cpu', dtype: 'q8' } } as unknown as ProviderCallCtx

afterEach(() => { FakeWorker.instances.length = 0 })

describe('HostedEmbeddings.close', () => {
  it('lets the running request finish before terminating the worker', async () => {
    const embeddings = new HostedEmbeddings({ perAccount: 4, total: 8 })
    const running = embeddings.forOwner('a').embed(['first'], 'document', context)
    const queued = embeddings.forOwner('b').embed(['second'], 'document', context)
    const worker = FakeWorker.instances[0]!
    expect(worker.requests.map(request => request.texts)).toEqual([['first']])

    const closed = embeddings.close()
    await expect(queued).rejects.toThrow('Hosted embeddings are shutting down')
    await Promise.resolve()
    expect(worker.terminated).toBe(0)

    worker.answer(worker.requests[0]!.id)
    await expect(running).resolves.toEqual([[1, 0]])
    await closed
    expect(worker.terminated).toBe(1)
    expect(worker.requests).toHaveLength(1)
  })

  it('refuses requests made while it waits', async () => {
    const embeddings = new HostedEmbeddings({ perAccount: 4, total: 8 })
    void embeddings.warm('m', 'cpu', 'q8')
    const worker = FakeWorker.instances[0]!
    const closed = embeddings.close()

    await expect(embeddings.forOwner('a').embed(['late'], 'query', context)).rejects.toThrow('Hosted embeddings are shutting down')
    worker.answer(worker.requests[0]!.id)
    await closed
    expect(worker.requests).toHaveLength(1)
    expect(worker.terminated).toBe(1)
  })

  it('stops waiting when the worker exits during the wait', async () => {
    const embeddings = new HostedEmbeddings({ perAccount: 4, total: 8 })
    const running = embeddings.forOwner('a').embed(['first'], 'document', context)
    const worker = FakeWorker.instances[0]!
    const closed = embeddings.close()

    worker.emit('exit', 1)
    await expect(running).rejects.toThrow('Hosted embedding worker exited (1)')
    await closed
    expect(worker.terminated).toBe(1)
  })

  it('terminates at once when nothing is running', async () => {
    const embeddings = new HostedEmbeddings({ perAccount: 4, total: 8 })
    await embeddings.close()
    expect(FakeWorker.instances).toHaveLength(0)
    await expect(embeddings.forOwner('a').embed(['after'], 'query', context)).rejects.toThrow('Hosted embeddings are shutting down')
  })
})
