/** Upstream-Node child lifecycle and streaming custom-protocol carrier. */

import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Readable, Writable } from 'node:stream'
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostResponseDecoder,
  encodeDesktopRequestCancel,
  encodeDesktopRequestData,
  encodeDesktopRequestEnd,
  encodeDesktopRequestStart,
  type DesktopAevenSignIn,
  type DesktopHostActivity,
  type DesktopHostCommand,
  type DesktopHostEvent,
  type DesktopHostResponseFrame,
} from './host-protocol.ts'

interface PendingResponse {
  readonly resolve: (response: Response) => void
  readonly reject: (error: Error) => void
  responseStarted: boolean
  uploadOpen: boolean
  controller?: ReadableStreamDefaultController<Uint8Array>
  requestReader?: ReadableStreamDefaultReader<Uint8Array>
  removeAbort?: () => void
}

function isAevenSignIn(value: unknown): value is DesktopAevenSignIn {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.apiUrl === 'string' && URL.canParse(candidate.apiUrl)
    && Array.isArray(candidate.oauthUrls) && candidate.oauthUrls.every(url => typeof url === 'string')
}

function isDesktopHostEvent(message: unknown): message is DesktopHostEvent {
  if (typeof message !== 'object' || message === null || !('type' in message)) return false
  const candidate = message as Record<string, unknown>
  switch (candidate.type) {
    case 'ready':
      return candidate.protocolVersion === DESKTOP_HOST_PROTOCOL_VERSION && typeof candidate.avnVersion === 'string'
        && typeof candidate.url === 'string' && URL.canParse(candidate.url) && typeof candidate.ownsHost === 'boolean'
        && (candidate.aevenSignIn === undefined || isAevenSignIn(candidate.aevenSignIn))
    case 'activity':
      return Number.isSafeInteger(candidate.runningAgents) && Number.isSafeInteger(candidate.clientLeases)
    case 'fatal':
      return typeof candidate.message === 'string'
    default:
      return false
  }
}

function errorOf(reason: unknown, fallback: string): Error {
  return reason instanceof Error ? reason : new Error(fallback)
}

async function settlesWithin<T>(settlement: Promise<T>, milliseconds: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => { resolve(undefined) }, milliseconds)
    timer.unref()
  })
  try {
    return await Promise.race([settlement, timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function exitsWithin(exit: Promise<void>, milliseconds: number): Promise<boolean> {
  return await settlesWithin(exit.then(() => true), milliseconds) ?? false
}

/** Ready facts reported by one installed avn child. */
export interface DesktopHostReady {
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION
  readonly avnVersion: string
  readonly url: string
  readonly ownsHost: boolean
  readonly aevenSignIn?: DesktopAevenSignIn
}

/** One avn backend running under the bundled upstream Node.js executable. */
export class DesktopHostProcess {
  private owner = false
  /** Whether this child owns the shared Host rather than reporting an incumbent. */
  get ownsHost(): boolean { return this.owner }

  private child: ChildProcess | undefined
  private requestPipe: Writable | undefined
  private responsePipe: Readable | undefined
  private readonly responseDecoder = new DesktopHostResponseDecoder()
  private requestWriteTail: Promise<void> = Promise.resolve()
  private nextStreamId = 1
  private readonly pending = new Map<number, PendingResponse>()
  private readonly blockedResponses = new Set<number>()
  private readyResolve!: (ready: DesktopHostReady) => void
  private readyReject!: (error: Error) => void
  private readonly readyPromise = new Promise<DesktopHostReady>((resolve, reject) => {
    this.readyResolve = resolve
    this.readyReject = reject
  })
  private exitPromise: Promise<void> | undefined
  private stderr = ''
  private readonly activityAnswers: ((activity: DesktopHostActivity) => void)[] = []

  /**
   * @param node - absolute bundled upstream Node.js executable.
   * @param projectDir - active or staged desktop npm project.
   * @param workDir - the Host's working directory: the active profile, or a directory outside every profile for a
   * staged health check, so nothing that Host leaves running can hold the staged profile against its rename on Windows.
   * @param inspectPort - optional loopback inspector port for workspace development.
   */
  constructor(
    private readonly node: string,
    private readonly projectDir: string,
    private readonly workDir: string,
    private readonly inspectPort?: number,
  ) {}

  /** Start the child once and resolve only after its complete composition is active. */
  async start(): Promise<DesktopHostReady> {
    if (this.child !== undefined) return this.readyPromise
    const entry = join(this.projectDir, 'node_modules', '@aeven', 'desktop-host', 'lib', 'index.js')
    mkdirSync(this.workDir, { recursive: true, mode: 0o700 })
    const child = spawn(this.node, [
      // The Cordis Loader imports plugins through Node's internal ESM loader. The flag reaches it directly; the
      // fallback, node-addon-require-builtin, ships a darwin-arm64 build that macOS 14 refuses to load.
      '--expose-internals',
      ...(this.inspectPort === undefined ? [] : [`--inspect=127.0.0.1:${String(this.inspectPort)}`]),
      entry,
      this.projectDir,
      ...(this.inspectPort === undefined ? [] : ['--allow-linked-profile']),
    ], {
      cwd: this.workDir,
      detached: true,
      env: Object.fromEntries(Object.entries(process.env).filter(([name]) => (
        name !== 'NODE_OPTIONS' && !/^AVN_DESKTOP_/u.test(name) && !/^(?:npm|pnpm|corepack)_/iu.test(name)
      ))),
      stdio: ['ignore', 'pipe', 'pipe', 'pipe', 'pipe', 'ipc'],
    })
    const requestPipe = child.stdio[DESKTOP_REQUEST_PIPE_FD]
    const responsePipe = child.stdio[DESKTOP_RESPONSE_PIPE_FD]
    if (!(requestPipe instanceof Writable) || !(responsePipe instanceof Readable)) {
      child.kill('SIGTERM')
      throw new Error('avn desktop host did not expose the required byte pipes and IPC channel')
    }
    this.child = child
    this.requestPipe = requestPipe
    this.responsePipe = responsePipe
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => { this.stderr += chunk })
    child.stdout?.pipe(process.stdout)
    responsePipe.on('data', (chunk: Buffer) => { this.acceptResponseBytes(chunk) })
    responsePipe.once('end', () => {
      try {
        this.responseDecoder.finish()
        this.fail(new Error('avn desktop host response pipe ended'))
      } catch (error) {
        this.fail(errorOf(error, 'avn desktop host response pipe failed'))
      }
    })
    requestPipe.once('error', (error) => { this.fail(error) })
    responsePipe.once('error', (error) => { this.fail(error) })
    child.on('message', (message: unknown) => {
      if (!isDesktopHostEvent(message)) {
        this.fail(new Error('avn desktop host sent an invalid IPC event'))
        child.kill('SIGTERM')
        return
      }
      this.handleMessage(message)
    })
    child.once('error', (error) => { this.fail(error) })
    this.exitPromise = new Promise<void>((resolve) => {
      child.once('exit', (code) => {
        const suffix = this.stderr.trim() === '' ? '' : `: ${this.stderr.trim()}`
        if (code !== 0 && code !== null) this.fail(new Error(`avn desktop host exited with ${String(code)}${suffix}`))
        else this.fail(new Error(`avn desktop host stopped${suffix}`))
        resolve()
      })
    })
    return this.readyPromise
  }

  /** Forward one `avn-app://app` request to the child without buffering its body. */
  async fetch(request: Request): Promise<Response> {
    await this.start()
    const child = this.child
    if (child === undefined || !child.connected || this.requestPipe === undefined) {
      throw new Error('avn desktop host is unavailable')
    }
    if (this.nextStreamId > 0xffff_ffff) throw new Error('avn desktop host exhausted its request stream ids')
    const streamId = this.nextStreamId++
    const method = request.method.toUpperCase()
    const hasBody = method !== 'GET' && method !== 'HEAD' && request.body !== null
    return new Promise<Response>((resolve, reject) => {
      const pending: PendingResponse = {
        resolve,
        reject,
        responseStarted: false,
        uploadOpen: hasBody,
      }
      const abort = (): void => {
        if (!this.pending.has(streamId)) return
        const error = errorOf(request.signal.reason, 'request aborted')
        pending.uploadOpen = false
        void pending.requestReader?.cancel(error).catch(() => undefined)
        this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((pipeError: unknown) => {
          this.fail(errorOf(pipeError, 'avn desktop request pipe failed'))
        })
        if (pending.controller === undefined) pending.reject(error)
        else pending.controller.error(error)
        this.finishPending(streamId, false)
      }
      if (request.signal.aborted) {
        reject(errorOf(request.signal.reason, 'request aborted'))
        return
      }
      request.signal.addEventListener('abort', abort, { once: true })
      pending.removeAbort = () => { request.signal.removeEventListener('abort', abort) }
      this.pending.set(streamId, pending)
      this.pumpRequest(streamId, request, hasBody).catch((error: unknown) => {
        this.failPending(streamId, errorOf(error, 'avn desktop request upload failed'))
      })
    })
  }

  /**
   * Ask the Host what would stop with it if this shell left.
   * @returns the Host's report, or undefined when the Host is gone or does not answer within two seconds.
   */
  async activity(): Promise<DesktopHostActivity | undefined> {
    const child = this.child
    if (child === undefined || !child.connected) return undefined
    let accept!: (activity: DesktopHostActivity) => void
    const answer = new Promise<DesktopHostActivity>((resolve) => { accept = resolve })
    this.activityAnswers.push(accept)
    try {
      this.send({ type: 'activity' })
      return await settlesWithin(answer, 2_000)
    } finally {
      const waiting = this.activityAnswers.indexOf(accept)
      if (waiting !== -1) this.activityAnswers.splice(waiting, 1)
    }
  }

  /**
   * Release this shell's lease without waiting: the Host stops on its own once
   * no client lease remains, or keeps serving the processes that hold one.
   */
  release(): void {
    const child = this.child
    if (child === undefined) return
    if (child.connected) child.disconnect()
    child.stdout?.unpipe(process.stdout)
    for (const pipe of child.stdio) pipe?.destroy()
    child.unref()
    this.child = undefined
  }

  /** Request graceful teardown, then wait for child exit. */
  async stop(): Promise<void> {
    const child = this.child
    if (child === undefined) return
    this.blockedResponses.clear()
    this.responsePipe?.resume()
    if (child.connected) this.send({ type: 'shutdown' })
    // Closing the parent-owned write end releases the Host's pending Windows pipe read.
    this.requestPipe?.destroy()
    const exited = this.exitPromise ?? Promise.resolve()
    if (!await exitsWithin(exited, 10_000)) child.kill('SIGTERM')
    if (!await exitsWithin(exited, 5_000)) {
      child.kill('SIGKILL')
      if (!await exitsWithin(exited, 5_000)) {
        throw new Error('avn desktop host did not exit after SIGKILL')
      }
    }
    this.child = undefined
    this.requestPipe = undefined
    this.responsePipe = undefined
  }

  private async pumpRequest(streamId: number, request: Request, hasBody: boolean): Promise<void> {
    await this.enqueueRequestFrame(encodeDesktopRequestStart(streamId, {
      url: request.url,
      method: request.method.toUpperCase(),
      headers: [...request.headers.entries()],
      hasBody,
    }))
    if (!hasBody) return
    const body = request.body
    if (body === null) throw new Error('avn desktop request body disappeared before upload')
    const reader = body.getReader()
    const pending = this.pending.get(streamId)
    if (pending === undefined) {
      await reader.cancel()
      return
    }
    pending.requestReader = reader
    try {
      for (;;) {
        const next = await reader.read()
        if (next.done) break
        for (let offset = 0; offset < next.value.byteLength; offset += DESKTOP_PIPE_CHUNK_BYTES) {
          if (!this.pending.has(streamId)) return
          await this.enqueueRequestFrame(encodeDesktopRequestData(
            streamId,
            next.value.subarray(offset, offset + DESKTOP_PIPE_CHUNK_BYTES),
          ))
        }
      }
      const live = this.pending.get(streamId)
      if (live !== undefined) {
        await this.enqueueRequestFrame(encodeDesktopRequestEnd(streamId))
        live.uploadOpen = false
      }
    } finally {
      reader.releaseLock()
      const live = this.pending.get(streamId)
      if (live?.requestReader === reader) delete live.requestReader
    }
  }

  private enqueueRequestFrame(frame: Buffer): Promise<void> {
    const write = this.requestWriteTail.then(async () => {
      const pipe = this.requestPipe
      if (pipe === undefined || pipe.destroyed) throw new Error('avn desktop host request pipe is unavailable')
      if (!pipe.write(frame)) await once(pipe, 'drain')
    })
    this.requestWriteTail = write.catch(() => undefined)
    return write
  }

  private send(message: DesktopHostCommand): void {
    const child = this.child
    if (child === undefined || !child.connected) throw new Error('avn desktop host IPC is unavailable')
    child.send(message)
  }

  private acceptResponseBytes(chunk: Buffer): void {
    try {
      for (const frame of this.responseDecoder.push(chunk)) this.handleResponseFrame(frame)
    } catch (error) {
      this.fail(errorOf(error, 'avn desktop host response pipe failed'))
      this.child?.kill('SIGTERM')
    }
  }

  private handleResponseFrame(frame: DesktopHostResponseFrame): void {
    const pending = this.pending.get(frame.streamId)
    if (pending === undefined) {
      if (frame.streamId >= this.nextStreamId) {
        throw new Error(`avn desktop host responded for unknown stream ${String(frame.streamId)}`)
      }
      return
    }
    switch (frame.type) {
      case 'start': {
        if (pending.responseStarted) throw new Error(`avn desktop host started stream ${String(frame.streamId)} twice`)
        pending.responseStarted = true
        let body: ReadableStream<Uint8Array> | null = null
        if (frame.hasBody) {
          body = new ReadableStream<Uint8Array>({
            start: (controller) => { pending.controller = controller },
            pull: () => {
              this.blockedResponses.delete(frame.streamId)
              this.resumeResponsePipe()
            },
            cancel: (reason) => { this.cancelResponse(frame.streamId, reason) },
          })
        }
        pending.resolve(new Response(body, {
          status: frame.status,
          headers: new Headers(frame.headers.map(([name, value]) => [name, value] as [string, string])),
        }))
        return
      }
      case 'data': {
        const controller = pending.controller
        if (!pending.responseStarted || controller === undefined) {
          throw new Error(`avn desktop host sent body data before a body start for stream ${String(frame.streamId)}`)
        }
        controller.enqueue(frame.data)
        if ((controller.desiredSize ?? 0) <= 0) {
          this.blockedResponses.add(frame.streamId)
          this.responsePipe?.pause()
        }
        return
      }
      case 'end':
        if (!pending.responseStarted) {
          throw new Error(`avn desktop host ended stream ${String(frame.streamId)} before its response start`)
        }
        pending.controller?.close()
        this.finishPending(frame.streamId, true)
        return
      case 'error':
        this.failPending(frame.streamId, new Error(frame.message))
        return
      default:
        frame satisfies never
    }
  }

  private cancelResponse(streamId: number, reason: unknown): void {
    const pending = this.pending.get(streamId)
    if (pending === undefined) return
    pending.uploadOpen = false
    void pending.requestReader?.cancel(reason).catch(() => undefined)
    this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((error: unknown) => {
      this.fail(errorOf(error, 'avn desktop request pipe failed'))
    })
    this.finishPending(streamId, false)
  }

  private failPending(streamId: number, error: Error): void {
    const pending = this.pending.get(streamId)
    if (pending === undefined) return
    pending.uploadOpen = false
    void pending.requestReader?.cancel(error).catch(() => undefined)
    if (pending.controller === undefined) pending.reject(error)
    else pending.controller.error(error)
    this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((pipeError: unknown) => {
      this.fail(errorOf(pipeError, 'avn desktop request pipe failed'))
    })
    this.finishPending(streamId, false)
  }

  private finishPending(streamId: number, cancelOpenUpload: boolean): void {
    const pending = this.pending.get(streamId)
    if (pending === undefined) return
    if (cancelOpenUpload && pending.uploadOpen) {
      pending.uploadOpen = false
      void pending.requestReader?.cancel().catch(() => undefined)
      this.enqueueRequestFrame(encodeDesktopRequestCancel(streamId)).catch((error: unknown) => {
        this.fail(errorOf(error, 'avn desktop request pipe failed'))
      })
    }
    pending.removeAbort?.()
    this.pending.delete(streamId)
    this.blockedResponses.delete(streamId)
    this.resumeResponsePipe()
  }

  private resumeResponsePipe(): void {
    if (this.blockedResponses.size === 0) this.responsePipe?.resume()
  }

  private handleMessage(message: DesktopHostEvent): void {
    switch (message.type) {
      case 'ready':
        this.owner = message.ownsHost
        this.readyResolve(message)
        return
      case 'activity':
        this.activityAnswers.shift()?.({ runningAgents: message.runningAgents, clientLeases: message.clientLeases })
        return
      case 'fatal':
        this.fail(new Error(message.message))
        return
      default:
        message satisfies never
    }
  }

  private fail(error: Error): void {
    this.readyReject(error)
    for (const pending of this.pending.values()) {
      void pending.requestReader?.cancel(error).catch(() => undefined)
      if (pending.controller === undefined) pending.reject(error)
      else pending.controller.error(error)
      pending.removeAbort?.()
    }
    this.pending.clear()
    this.blockedResponses.clear()
    this.responsePipe?.resume()
  }
}
