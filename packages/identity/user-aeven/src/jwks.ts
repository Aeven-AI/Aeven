/**
 * The Aeven API's published verification keys, held in memory and refreshed on demand.
 * @module @aeven/identity-user-aeven/jwks
 */

import type { KeyObject } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { parseKeySet } from './jwt.ts'

/** Settings for one {@link RemoteKeySet}. */
export interface RemoteKeySetOptions {
  /** The API's `/.well-known/jwks.json` URL. */
  readonly url: string
  /** Least time between two fetches, so a stream of tokens naming an unknown key costs one request. */
  readonly minRefreshIntervalMs: number
  /** Budget for one fetch. */
  readonly timeoutMs: number
  /** Sink for a failed fetch; verification keeps the previous keys. */
  readonly warn: (message: string) => void
  /**
   * File holding the last key set fetched, so a Host started while the API is unreachable
   * still verifies tokens; absent keeps the keys in memory only. The keys are public.
   */
  readonly cacheFile?: string
}

/**
 * Public keys by key id, fetched from the API.
 *
 * Verification stays synchronous: {@link keyFor} answers from memory, and a key id the set does
 * not hold starts a background refresh, so a token signed by a newly rotated key verifies on the
 * caller's next request. Refreshes are serialized and rate-limited by `minRefreshIntervalMs`.
 */
export class RemoteKeySet {
  private keys = new Map<string, KeyObject>()
  private inFlight: Promise<void> | undefined
  private lastAttempt = Number.NEGATIVE_INFINITY
  private readonly controller = new AbortController()

  /**
   * @param options - the key set URL, refresh pacing, and failure sink.
   */
  constructor(private readonly options: RemoteKeySetOptions) {}

  /**
   * The key published under `kid`; a miss starts a rate-limited background refresh.
   * @param kid - key id from a token header.
   * @returns the public key, or undefined when the set does not hold it yet.
   */
  keyFor(kid: string): KeyObject | undefined {
    const key = this.keys.get(kid)
    if (key === undefined && Date.now() - this.lastAttempt >= this.options.minRefreshIntervalMs) void this.refresh()
    return key
  }

  /**
   * Fetch the key set now, or join the fetch already running.
   * @returns settles when the fetch completes; a failure is reported through `warn`, not thrown.
   */
  refresh(): Promise<void> {
    if (this.inFlight !== undefined) return this.inFlight
    this.lastAttempt = Date.now()
    this.inFlight = this.fetchKeys().finally(() => { this.inFlight = undefined })
    return this.inFlight
  }

  /**
   * Adopt the key set {@link RemoteKeySetOptions.cacheFile} holds.
   * @returns true when the file held at least one usable key, which is then verified against until a fetch replaces it.
   */
  async load(): Promise<boolean> {
    const file = this.options.cacheFile
    if (file === undefined) return false
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      // Absent until the first fetch succeeds, which is the only writer.
      return false
    }
    let keys: Map<string, KeyObject>
    try {
      keys = parseKeySet(JSON.parse(text))
    } catch (error) {
      this.options.warn(`identity-user-aeven: ignoring unreadable key set cache ${file}: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
    if (keys.size === 0 || this.keys.size > 0) return false
    this.keys = keys
    return true
  }

  /** Abort any running fetch; later refreshes do nothing. */
  dispose(): void {
    this.controller.abort()
  }

  private async fetchKeys(): Promise<void> {
    if (this.isDisposed()) return
    try {
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(this.options.timeoutMs)])
      const response = await fetch(this.options.url, { headers: { Accept: 'application/json' }, signal, redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`)
      const text = await response.text()
      const keys = parseKeySet(JSON.parse(text))
      if (keys.size === 0) throw new Error('the key set holds no ES256 key')
      this.keys = keys
      await this.store(text)
    } catch (error) {
      // A fetch that fails because the set was disposed says nothing about the API.
      if (this.isDisposed()) return
      this.options.warn(`identity-user-aeven: could not load ${this.options.url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Replace the cache file with a fetched key set; a failed write leaves the previous file.
   * @param text - the key set document as the API served it.
   */
  private async store(text: string): Promise<void> {
    const file = this.options.cacheFile
    if (file === undefined) return
    const staging = `${file}.${String(process.pid)}.tmp`
    try {
      await mkdir(dirname(file), { recursive: true })
      await writeFile(staging, text)
      await rename(staging, file)
    } catch (error) {
      this.options.warn(`identity-user-aeven: could not write ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Whether {@link dispose} has aborted the loader. */
  private isDisposed(): boolean {
    return this.controller.signal.aborted
  }
}
