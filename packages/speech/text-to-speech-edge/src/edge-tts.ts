/** Owned Edge read-aloud client: one socket per voice, one turn per utterance, MP3 frames as they arrive. */
import { createHash, randomUUID } from 'node:crypto'
import WebSocket from 'ws'

/**
 * The application token Edge's own read-aloud sends. It identifies the client, not a reader, and is the
 * same value the public clients of this service publish.
 */
const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4'

/**
 * Synthesis socket. Edge itself synthesizes here; the legacy `speech.platform.bing.com` host still
 * answers but stalls for seconds and drops turns.
 */
const SYNTHESIS_URL = 'wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1'

/** The voice list still answers on the legacy host and refuses every request on the synthesis host. */
const VOICES_URL = `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`

/** Build string that pairs with the `Sec-MS-GEC` token; the `1-` prefix is part of the token scheme. */
const SEC_MS_GEC_VERSION = '1-143.0.3650.75'

/** Headers Edge's own client sends; the service rejects a bare handshake. */
const HEADERS = {
  Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0',
  Pragma: 'no-cache',
  'Cache-Control': 'no-cache',
  'Accept-Language': 'en-US,en;q=0.9',
} as const

/** Frames between a frame's headers and its payload. */
const DELIMITER = '\r\n\r\n'

/** Last header line of a binary frame; everything after it is audio. */
const AUDIO_HEADER_END = 'Path:audio\r\n'

/** The one encoding this provider asks for, which the browser decodes with `decodeAudioData`. */
export const OUTPUT_FORMAT = {
  AUDIO_24KHZ_48KBITRATE_MONO_MP3: 'audio-24khz-48kbitrate-mono-mp3',
} as const

/** Deadlines for one client. */
export interface EdgeClientOptions {
  /** Longest silence inside one turn before it fails, in milliseconds. */
  synthesisTimeoutMs?: number
  /** Longest wait for the socket handshake, in milliseconds. */
  connectionTimeoutMs?: number
}

/** One voice as the service lists it. */
export interface EdgeVoiceEntry {
  readonly ShortName: string
  readonly Locale: string
  readonly Gender?: string
}

/** The audio of one utterance, frames in arrival order. */
export interface EdgeTurn {
  readonly audioStream: AsyncIterable<Uint8Array>
}

/** One utterance waiting on the socket. */
interface Turn {
  readonly frames: Uint8Array[]
  /** Wakes the reader waiting on this turn; set only while it waits. */
  notify: (() => void) | undefined
  ended: boolean
  failure: Error | undefined
}

/** Difference between this machine's clock and the service's, learned from a rejected handshake. */
let clockOffsetMs = 0

/**
 * A client for the Edge read-aloud socket: connect once per voice, then send any number of turns down
 * that connection. Turns are matched to their responses by request id, so a turn its reader abandoned
 * cannot disturb the next one.
 */
export class MsEdgeTTS {
  private socket: WebSocket | undefined
  private opening: Promise<void> | undefined
  private readonly turns = new Map<string, Turn>()
  /** Voice the next turn speaks with; changing it needs no reconnect because every turn names its voice. */
  voiceName = ''
  /** Output format announced to the service when the socket opens. */
  format: string | undefined
  private voiceLocale = ''
  private readonly synthesisTimeoutMs: number
  private readonly connectionTimeoutMs: number

  /**
   * @param options - handshake and in-turn deadlines.
   */
  constructor(options: EdgeClientOptions = {}) {
    this.synthesisTimeoutMs = options.synthesisTimeoutMs ?? 60_000
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 10_000
  }

  /**
   * List the voices the service publishes.
   * @returns every voice entry the service answers with.
   */
  async getVoices(): Promise<EdgeVoiceEntry[]> {
    const response = await fetch(VOICES_URL)
    if (!response.ok) throw new Error(`Edge voice list answered ${response.status}`)
    return await response.json() as EdgeVoiceEntry[]
  }

  /**
   * Configure the voice and format, connecting on first use. The socket is reused across voices: each
   * turn's SSML names its own voice, so switching speakers costs no handshake.
   * @param voiceName - service voice id, such as `en-US-AvaMultilingualNeural`.
   * @param outputFormat - format every following utterance is encoded in.
   */
  async setMetadata(voiceName: string, outputFormat: string): Promise<void> {
    const locale = /\b[a-z]{2,}-[A-Z]{2}\b/.exec(voiceName)?.[0]
    if (locale === undefined) throw new Error(`Cannot infer a locale from the voice id: ${voiceName}`)
    this.voiceName = voiceName
    this.voiceLocale = locale
    this.format = outputFormat
    await this.connect()
  }

  /**
   * Speak one utterance on the configured socket.
   * @param text - plain text, escaped before it reaches the SSML body.
   * @returns the utterance's audio frames.
   */
  toStream(text: string): EdgeTurn {
    const socket = this.socket
    if (socket === undefined || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Edge TTS is not connected; call setMetadata first')
    }
    const requestId = randomUUID().replace(/-/g, '')
    const turn: Turn = { frames: [], notify: undefined, ended: false, failure: undefined }
    this.turns.set(requestId, turn)
    socket.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${timestamp()}Z\r\nPath:ssml${DELIMITER}${this.ssml(text)}`)
    return { audioStream: this.framesOf(requestId, turn) }
  }

  /** Close the socket; turns still streaming fail rather than end silently with truncated audio. */
  close(): void {
    for (const turn of this.turns.values()) this.failTurn(turn, new Error('Edge TTS client closed before the utterance finished'))
    this.turns.clear()
    const socket = this.socket
    this.socket = undefined
    this.opening = undefined
    socket?.terminate()
  }

  /**
   * Yield one turn's frames until the service ends it, fails it, or its reader stops consuming.
   * @param requestId - id the service echoes on this turn's frames.
   * @param turn - the turn's buffered frames.
   */
  private async *framesOf(requestId: string, turn: Turn): AsyncGenerator<Uint8Array> {
    try {
      for (;;) {
        if (turn.failure !== undefined) throw turn.failure
        const frame = turn.frames.shift()
        if (frame !== undefined) {
          yield frame
          continue
        }
        if (turn.ended) return
        const notified = await this.wait(turn)
        if (!notified && turn.frames.length === 0 && !turn.ended && turn.failure === undefined) {
          throw new Error(`Edge TTS synthesis timed out after ${this.synthesisTimeoutMs} milliseconds without activity`)
        }
      }
    } finally {
      this.turns.delete(requestId)
    }
  }

  /**
   * Wait for the next frame of one turn, no longer than the synthesis deadline.
   * @param turn - turn its reader is waiting on.
   * @returns whether the service woke the wait.
   */
  private async wait(turn: Turn): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => { resolve(false) }, this.synthesisTimeoutMs)
      turn.notify = () => { clearTimeout(timer); resolve(true) }
    })
  }

  /**
   * Open the socket and configure it, reusing the open one, retrying once after a clock-skew rejection.
   * @param retryClock - whether a 403 may be answered by correcting this machine's clock and reconnecting.
   */
  private async connect(retryClock = true): Promise<void> {
    if (this.socket?.readyState === WebSocket.OPEN) return
    if (this.opening !== undefined) return await this.opening
    const opening = this.openSocket().catch(async (error: unknown) => {
      const rejected = error as { statusCode?: number; serverTime?: number }
      if (!retryClock || rejected.statusCode !== 403) throw error
      if (rejected.serverTime !== undefined) clockOffsetMs = rejected.serverTime - Date.now()
      return await this.connect(false)
    })
    this.opening = opening
    try {
      await opening
    } finally {
      this.opening = undefined
    }
  }

  /** @returns nothing once the socket is open and configured. */
  private async openSocket(): Promise<void> {
    const url = `${SYNTHESIS_URL}?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}`
      + `&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${randomUUID().replace(/-/g, '')}`
    const socket = new WebSocket(url, { headers: HEADERS })
    this.socket = socket
    socket.on('message', (data, isBinary) => { this.receive(data as Buffer, isBinary) })
    socket.on('close', () => {
      if (this.socket !== socket) return
      this.socket = undefined
      for (const turn of this.turns.values()) this.failTurn(turn, new Error('Edge TTS connection closed before the utterance finished'))
    })
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.terminate()
        reject(new Error(`Edge TTS connection timed out after ${this.connectionTimeoutMs} milliseconds`))
      }, this.connectionTimeoutMs)
      socket.once('open', () => { clearTimeout(timer); resolve() })
      socket.once('error', (error) => { clearTimeout(timer); reject(error) })
      socket.once('unexpected-response', (_request, response) => {
        clearTimeout(timer)
        socket.terminate()
        reject(Object.assign(new Error(`Edge TTS handshake answered ${response.statusCode}`), {
          statusCode: response.statusCode,
          serverTime: Date.parse(response.headers.date ?? ''),
        }))
      })
    })
    socket.send(`X-Timestamp:${timestamp()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config${DELIMITER}`
      + JSON.stringify({ context: { synthesis: { audio: {
        metadataoptions: { sentenceBoundaryEnabled: 'false', wordBoundaryEnabled: 'false' },
        outputFormat: this.format,
      } } } }))
  }

  /**
   * @param text - utterance text.
   * @returns the SSML request body naming the configured voice.
   */
  private ssml(text: string): string {
    return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${this.voiceLocale}">`
      + `<voice name="${this.voiceName}"><prosody pitch="+0Hz" rate="+0%" volume="+0%">${escapeSsml(text)}</prosody></voice></speak>`
  }

  /**
   * Route one service frame to its turn.
   * @param data - raw frame.
   * @param isBinary - whether the frame carries audio.
   */
  private receive(data: Buffer, isBinary: boolean): void {
    if (isBinary) {
      // A binary frame is a 2-byte header length, the headers, then the audio directly after
      // `Path:audio`, with no blank line in between.
      if (data.length < 2) return
      const headerLength = data.readUInt16BE(0)
      if (2 + headerLength > data.length) return
      const audioStart = data.indexOf(AUDIO_HEADER_END)
      if (audioStart < 0) return
      const headers = data.subarray(0, audioStart + AUDIO_HEADER_END.length).toString()
      const audio = data.subarray(audioStart + AUDIO_HEADER_END.length)
      if (audio.length === 0) return
      const turn = this.turns.get(requestIdOf(headers))
      if (turn === undefined) return
      turn.frames.push(audio)
      turn.notify?.()
      return
    }
    const text = data.toString()
    const turn = this.turns.get(requestIdOf(text))
    if (turn === undefined) return
    if (text.includes('Path:turn.end')) turn.ended = true
    else if (!text.includes('Path:audio.metadata') && !text.includes('Path:response') && !text.includes('Path:turn.start')) return
    turn.notify?.()
  }

  /**
   * @param turn - turn to stop.
   * @param failure - error its reader sees.
   */
  private failTurn(turn: Turn, failure: Error): void {
    turn.failure = failure
    turn.notify?.()
  }
}

/**
 * @param frame - service frame text.
 * @returns the request id its headers carry, or an id no turn uses.
 */
function requestIdOf(frame: string): string {
  return /X-RequestId:(.*?)\r\n/.exec(frame)?.[1] ?? ''
}

/**
 * Escape text for an SSML body: markup characters become entities, and the control characters the
 * service refuses (vertical tab most often, from OCR-ed documents) become spaces.
 * @param text - plain utterance text.
 * @returns the same text, safe inside `<prosody>`.
 */
function escapeSsml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ' ')
}

/** @returns the current time in this service's timestamp format, without the trailing `Z` its SSML header adds. */
function timestamp(): string {
  return new Date().toUTCString().replace('GMT', 'GMT+0000 (Coordinated Universal Time)')
}

/**
 * @returns the `Sec-MS-GEC` token: SHA-256 of the current five-minute window in Windows ticks followed by
 * the application token, in upper-case hex.
 */
function secMsGec(): string {
  const seconds = Math.floor((Date.now() + clockOffsetMs) / 1000) + 11_644_473_600
  const windowTicks = (seconds - seconds % 300) * 10_000_000
  return createHash('sha256').update(`${windowTicks}${TRUSTED_CLIENT_TOKEN}`).digest('hex').toUpperCase()
}
