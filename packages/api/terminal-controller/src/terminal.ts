/** One PTY, a bounded terminal emulator and its detachable browser followers. */
import { RemoteError } from '@aeven/typert-protocol'
import type { Terminal as HeadlessTerminal } from '@xterm/headless'
import type { SerializeAddon as Serializer } from '@xterm/addon-serialize'
import type { SubprocessTerminalHandle } from '@aeven/subprocess'
import { createRequire } from 'node:module'
import { TerminalFollower } from './stream.ts'
import { TerminalRetention, UNKNOWN_ACTIVITY, type TerminalRetentionPolicy } from './retention.ts'
import type { TerminalAttachmentId, TerminalFrame, TerminalRetentionFrame, WebTerminalInfo } from './types.ts'

// Both xterm packages ship CommonJS only; loaded on the first terminal, not at plugin load.
const requireModule = createRequire(import.meta.url)
const requireHeadless = (): typeof import('@xterm/headless') => requireModule('@xterm/headless') as typeof import('@xterm/headless')
const requireSerialize = (): typeof import('@xterm/addon-serialize') =>
  requireModule('@xterm/addon-serialize') as typeof import('@xterm/addon-serialize')

/** Process lifetime is independent of follower and component lifetimes. */
export class BrowserTerminal {
  private readonly screen: HeadlessTerminal
  private readonly serializer: Serializer
  private readonly followers = new Set<TerminalFollower>()
  private sequence = 0
  private operations: Promise<unknown> = Promise.resolve()
  private readonly drained: Promise<void>
  private closing: Promise<void> | undefined
  private retention: TerminalRetention | undefined
  private controller: { id: TerminalAttachmentId; follower: TerminalFollower } | undefined

  /**
   * @param handle - allocated terminal process range.
   * @param info - initial metadata.
   * @param scrollback - maximum retained scrollback rows.
   * @param maxBufferedBytes - per-follower queue cap.
   */
  constructor(
    private readonly handle: SubprocessTerminalHandle,
    public info: WebTerminalInfo,
    scrollback: number,
    private readonly maxBufferedBytes: number,
  ) {
    const { Terminal } = requireHeadless()
    const { SerializeAddon } = requireSerialize()
    this.screen = new Terminal({ cols: info.cols, rows: info.rows, scrollback, allowProposedApi: true })
    this.serializer = new SerializeAddon()
    this.screen.loadAddon(this.serializer)
    this.drained = this.consume()
  }

  /**
   * Start monitoring after this allocation is committed to its Session owner.
   * @param policy - validated Host timing policy.
   * @param closing - closes the id before any asynchronous termination.
   * @param closed - removes the exact successfully terminated owner record.
   * @param failed - diagnostic sink for background cleanup failure.
   */
  monitor(policy: TerminalRetentionPolicy, closing: () => void, closed: () => void, failed: (error: unknown) => void): void {
    this.retention = new TerminalRetention(policy, () => Promise.resolve(UNKNOWN_ACTIVITY), async () => {
      closing()
      await this.closeProcess()
      closed()
    }, failed)
  }

  /**
   * Retain this committed process independently of output attachment.
   * @param signal - physical window stream lifetime.
   * @returns its hold acknowledgement and lifetime.
   */
  retain(signal: AbortSignal): AsyncIterable<TerminalRetentionFrame> {
    if (this.retention === undefined) throw new Error('Terminal has not been committed')
    return this.retention.retain(signal)
  }

  /**
   * Attach with exclusive input control; an older attachment becomes read-only.
   * @param id - browser attachment identity.
   * @param signal - attachment cancellation; never terminates the process.
   * @returns a consistent screen followed by ordered output and state changes.
   */
  async *follow(id: TerminalAttachmentId, signal: AbortSignal): AsyncIterable<TerminalFrame> {
    signal.throwIfAborted()
    const follower = new TerminalFollower(this.maxBufferedBytes)
    const baseline = await this.enqueue(() => {
      signal.throwIfAborted()
      this.controller = { id, follower }
      this.info = { ...this.info, controllerId: id }
      this.broadcast({ type: 'state', info: this.info })
      const snapshot: TerminalFrame = { type: 'snapshot', sequence: this.sequence, screen: this.serializer.serialize(), info: this.info }
      this.followers.add(follower)
      return snapshot
    })
    try {
      yield baseline
      yield* follower.read(signal)
    } finally {
      this.followers.delete(follower)
      follower.close()
      if (this.controller?.follower === follower) {
        this.controller = undefined
        const { controllerId: _controllerId, ...info } = this.info
        this.info = info
        this.broadcast({ type: 'state', info })
      }
    }
  }

  /**
   * Send raw terminal input without command interpretation.
   * @param id - current writable attachment.
   * @param data - UTF-8 input, including shell completion/control keys.
   * @returns when the provider accepts the input.
   */
  write(id: TerminalAttachmentId, data: string): Promise<void> {
    this.retention?.invalidate()
    return this.enqueue(async () => { this.requireController(id); await this.handle.write(data) })
  }

  /**
   * Read rendered text without attaching or changing browser input ownership.
   * @param count - positive maximum number of newest screen and history lines.
   * @param maxBytes - maximum UTF-8 bytes returned to the model.
   * @returns a consistent text snapshot and whether older text was omitted.
   */
  read(count: number, maxBytes: number): Promise<{ text: string; truncated: boolean }> {
    return this.enqueue(() => {
      const buffer = this.screen.buffer.active
      const lines: string[] = []
      let bytes = 0
      let truncated = buffer.length > count
      for (let index = buffer.length - 1; index >= Math.max(0, buffer.length - count); index -= 1) {
        const bufferLine = buffer.getLine(index)
        if (bufferLine === undefined) break
        const line = bufferLine.translateToString(true)
        const size = Buffer.byteLength(line, 'utf8') + (lines.length === 0 ? 0 : 1)
        if (bytes + size > maxBytes) { truncated = true; break }
        lines.unshift(line)
        bytes += size
      }
      return { text: lines.join('\n'), truncated }
    })
  }

  /**
   * Share ordered raw input with the browser without replacing its attachment.
   * @param data - approved UTF-8 text or terminal control characters.
   * @returns after provider acceptance; this does not imply command completion.
   */
  send(data: string): Promise<void> {
    this.retention?.invalidate()
    return this.enqueue(async () => { this.requireRunning(); await this.handle.write(data) })
  }

  /**
   * Resize from an approved tool call without taking browser input ownership.
   * @param cols - validated width.
   * @param rows - validated height.
   * @returns after provider and emulator dimensions agree.
   */
  setDimensions(cols: number, rows: number): Promise<void> {
    return this.enqueue(async () => { this.requireRunning(); await this.resizeScreen(cols, rows) })
  }

  /**
   * Resize the PTY and recovery screen in the same operation order as output.
   * @param id - current writable attachment.
   * @param cols - validated column count.
   * @param rows - validated row count.
   * @returns when the provider and emulator use the new dimensions.
   */
  resize(id: TerminalAttachmentId, cols: number, rows: number): Promise<void> {
    return this.enqueue(async () => {
      this.requireController(id)
      await this.resizeScreen(cols, rows)
    })
  }

  /**
   * Publish a display name to every attached view.
   * @param title - validated user title.
   */
  rename(title: string): void {
    this.info = { ...this.info, title }
    this.broadcast({ type: 'state', info: this.info })
  }

  /**
   * Terminate the complete provider-owned process range before releasing its screen.
   * @returns after process cleanup and final output drainage; failures remain retryable.
   */
  close(): Promise<void> {
    return this.retention?.close() ?? this.closeProcess()
  }

  /**
   * Stop unattended cleanup scheduling and await final process cleanup.
   * @returns after terminal and monitor quiescence.
   */
  dispose(): Promise<void> { return this.retention?.dispose() ?? this.closeProcess() }

  private closeProcess(): Promise<void> {
    if (this.closing !== undefined) return this.closing
    this.closing = (async () => {
      await this.handle.terminate()
      await this.drained
      for (const follower of this.followers) follower.finish()
      this.followers.clear()
      this.screen.dispose()
    })().catch((error: unknown) => { this.closing = undefined; throw error })
    return this.closing
  }

  private async resizeScreen(cols: number, rows: number): Promise<void> {
    await this.handle.resize(cols, rows)
    this.screen.resize(cols, rows)
    this.info = { ...this.info, cols, rows }
    this.broadcast({ type: 'state', info: this.info })
  }

  private requireRunning(): void {
    if (this.closing !== undefined || this.info.state !== 'running') throw new RemoteError('terminal/control-unavailable', 'Terminal is not running', { reason: 'not-running' })
  }

  private requireController(id: TerminalAttachmentId): void {
    this.requireRunning()
    if (this.controller?.id !== id) throw new RemoteError('terminal/control-unavailable', 'Terminal input is controlled by another attachment', { reason: 'read-only' })
  }

  private broadcast(frame: TerminalFrame): void {
    for (const follower of this.followers) follower.push(frame)
  }

  private enqueue<T>(operation: () => T | Promise<T>): Promise<T> {
    const pending = this.operations.then(operation)
    this.operations = pending.catch(() => { /* The caller owns this operation's failure; later cleanup must still run. */ })
    return pending
  }

  private async consume(): Promise<void> {
    const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
    const outcome = this.handle.done.then(value => ({ value }), (error: unknown) => ({ error }))
    try {
      for await (const chunk of this.handle.output) {
        // Node Readable's iterator is untyped; this provider explicitly emits Buffer chunks.
        const data = decoder.decode(chunk as Buffer, { stream: true })
        await this.output(data)
      }
      await this.output(decoder.decode())
      const result = await outcome
      if ('error' in result) throw result.error
      this.info = { ...this.info, state: 'exited', exitCode: result.value.exitCode }
    } catch (error) {
      this.info = { ...this.info, state: 'failed', error: error instanceof Error ? error.message : String(error) }
    }
    this.broadcast({ type: 'state', info: this.info })
  }

  private async output(data: string): Promise<void> {
    if (data.length === 0) return
    await this.enqueue(async () => {
      await new Promise<void>((resolve) => { this.screen.write(data, resolve) })
      this.broadcast({ type: 'output', sequence: ++this.sequence, data })
    })
  }
}
