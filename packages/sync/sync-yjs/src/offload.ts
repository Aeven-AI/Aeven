/**
 * Runs account sync's CPU-heavy work on one worker thread, so a device catching up on a long history keeps the
 * Host's event loop for HTTP, the agent loop, and the UI. Requests are answered in the order they were sent. A
 * worker that exits is replaced at the next request; the requests it held fail.
 */
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import type { DeviceId, DeviceKeys, DevicePublicKeys, EnvelopeHeader, KeyEpoch, RemovedDevice } from '@aeven/sync-vault'

/** One frame to open, with its relay sequence number. */
export interface InboundFrame {
  readonly seq: number
  readonly frame: Uint8Array
}

/** One frame after opening: its header and payload, or why it could not be opened. */
export type OpenedFrame =
  | { readonly seq: number; readonly header: EnvelopeHeader; readonly payload: Uint8Array }
  | { readonly seq: number; readonly error: string }

/** A request to the worker. */
export type WorkerRequest =
  | {
    readonly id: number
    readonly method: 'open'
    readonly frames: readonly InboundFrame[]
    readonly keyring: ReadonlyArray<readonly [KeyEpoch, Uint8Array]>
    readonly devices: ReadonlyMap<DeviceId, DevicePublicKeys>
    readonly removed: ReadonlyMap<DeviceId, RemovedDevice>
  }
  | ({ readonly id: number; readonly method: 'maintain' } & MaintainRequest)

/** Compact one document's stored updates and, when due, queue a snapshot of it; the worker writes both. */
export interface MaintainRequest {
  /** The store's database path. */
  readonly path: string
  /** The document. */
  readonly doc: string
  /** Whether to replace the stored updates with one merged update. */
  readonly compact: boolean
  /** Seal input for a snapshot frame queued with the relay sequence number it covers. */
  readonly snapshot?: {
    readonly epoch: KeyEpoch
    readonly vaultKey: Uint8Array
    readonly sender: DeviceKeys
    readonly counter: number
    readonly covers: number
  }
}

/** The worker's answer to one request. */
export type WorkerReply =
  | { readonly id: number; readonly ok: true; readonly value: OpenedFrame[] | null }
  | { readonly id: number; readonly ok: false; readonly message: string }

/** A request before the client numbers it. */
type Unnumbered<T> = T extends { readonly id: number } ? Omit<T, 'id'> : never

type Pending = { resolve: (value: OpenedFrame[] | null) => void; reject: (error: Error) => void }

/** Where the worker's code is: the built CommonJS bundle, or the TypeScript source loaded through tsx. */
function workerEntry(): string | URL {
  const moduleUrl = import.meta.url
  if (!moduleUrl.endsWith('.ts')) return fileURLToPath(new URL('./worker.cjs', moduleUrl))
  const require = createRequire(moduleUrl)
  const bootstrap = [
    `import { register } from ${JSON.stringify(pathToFileURL(require.resolve('tsx/esm/api')).href)}`,
    'register()',
    `await import(${JSON.stringify(new URL('./worker.ts', moduleUrl).href)})`,
  ].join('\n')
  return new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`)
}

/** The sync worker of one provider. */
export class SyncOffload {
  private worker: Worker | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  private start(): Worker {
    if (this.worker !== undefined) return this.worker
    const worker = new Worker(workerEntry(), { execArgv: [] })
    // The worker only serves requests; it never keeps the Host process alive.
    worker.unref()
    worker.on('message', (reply: WorkerReply) => {
      const pending = this.pending.get(reply.id)
      this.pending.delete(reply.id)
      if (reply.ok) pending?.resolve(reply.value)
      else pending?.reject(new Error(reply.message))
    })
    const fail = (error: Error): void => {
      if (this.worker === worker) this.worker = undefined
      for (const pending of this.pending.values()) pending.reject(error)
      this.pending.clear()
    }
    worker.on('error', fail)
    worker.on('exit', (code) => { fail(new Error(`account sync worker exited with code ${String(code)}`)) })
    this.worker = worker
    return worker
  }

  private request(message: Unnumbered<WorkerRequest>): Promise<OpenedFrame[] | null> {
    const worker = this.start()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      worker.postMessage({ ...message, id })
    })
  }

  /**
   * Open received frames: check each signature against the chain and decrypt it.
   * @param frames - the frames, in sequence order.
   * @param keys - the vault's key generations and the chain's active and removed devices.
   * @returns each frame opened or the reason it was dropped, in the same order.
   */
  async open(
    frames: readonly InboundFrame[],
    keys: {
      readonly keyring: ReadonlyMap<KeyEpoch, Uint8Array>
      readonly devices: ReadonlyMap<DeviceId, DevicePublicKeys>
      readonly removed: ReadonlyMap<DeviceId, RemovedDevice>
    },
  ): Promise<OpenedFrame[]> {
    return await this.request({ method: 'open', frames, keyring: [...keys.keyring], devices: keys.devices, removed: keys.removed }) as OpenedFrame[]
  }

  /**
   * Compact a document and queue its snapshot on the worker, which reads and writes the store itself.
   * @param request - the store, the document, and what to do.
   * @returns when the store holds the result.
   */
  async maintain(request: MaintainRequest): Promise<void> {
    await this.request({ method: 'maintain', ...request })
  }

  /** Stop the worker; requests it held fail. */
  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    await worker?.terminate()
  }
}
