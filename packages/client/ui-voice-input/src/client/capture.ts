/**
 * Speech-only microphone capture. An AudioWorklet high-passes the microphone, resamples it to 16 kHz,
 * cuts it into 20 ms frames, and keeps only the frames its RMS voice detector marks as talking (with
 * hysteresis, a hangover, and a short pre-roll so word onsets survive). Silence never leaves the
 * browser; the kept frames become one canonical PCM16 WAV.
 */

/** Voice-detection tuning handed to the worklet; RMS thresholds are linear amplitudes. */
export interface VoiceDetection {
  /** Frame RMS at or above which talking starts. */
  readonly startThreshold: number
  /** Frame RMS below which talking may stop; lower than `startThreshold` (hysteresis). */
  readonly stopThreshold: number
  /** Time talking continues after the RMS falls below `stopThreshold`. */
  readonly hangoverMs: number
  /** Silent audio kept before each talking onset. */
  readonly preRollMs: number
  /** One-pole high-pass cutoff removing rumble and DC before detection. */
  readonly highPassHz: number
}

/** Detection defaults from the Aeven web client's dictation worklets. */
export const DEFAULT_VOICE_DETECTION: VoiceDetection = {
  startThreshold: 0.02, stopThreshold: 0.012, hangoverMs: 300, preRollMs: 200, highPassHz: 70,
}

/** Capture failure whose message the caller localizes. */
export class CaptureError extends Error {
  constructor(readonly kind: 'unavailable' | 'permission') { super(kind); this.name = 'CaptureError' }
}

const PROCESSOR = 'avn-dictation'

// The worklet runs in the AudioWorkletGlobalScope; it ships as source so the page needs no extra asset route.
const WORKLET_SOURCE = `
class AvnDictationProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions
    this.ratio = sampleRate / 16000
    this.buffer = new Float32Array(0)
    this.pos = 0
    this.frameSamples = 320
    this.accum = []
    this.startThresh = o.startThreshold
    this.stopThresh = o.stopThreshold
    this.hangoverFrames = Math.max(1, Math.round(o.hangoverMs / 20))
    this.preRollFrames = Math.max(0, Math.round(o.preRollMs / 20))
    const rc = 1 / (2 * Math.PI * o.highPassHz)
    this.hpA = rc / (rc + 1 / sampleRate)
    this.hpPrevIn = 0
    this.hpPrevOut = 0
    this.isTalking = false
    this.silenceCount = 0
    this.preRoll = []
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0 || input[0].length === 0) return true
    const mono = new Float32Array(input[0].length)
    for (const channel of input) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / input.length
    for (let i = 0; i < mono.length; i++) {
      const y = mono[i] - this.hpPrevIn + this.hpA * this.hpPrevOut
      this.hpPrevIn = mono[i]
      this.hpPrevOut = y
      mono[i] = y
    }
    const resampled = this.resampleChunk(mono)
    for (let i = 0; i < resampled.length; i++) this.accum.push(resampled[i])
    this.flushFrames()
    return true
  }

  flushFrames() {
    while (this.accum.length >= this.frameSamples) {
      const frameF32 = this.accum.splice(0, this.frameSamples)
      let sum = 0
      for (let i = 0; i < this.frameSamples; i++) sum += frameF32[i] * frameF32[i]
      const rms = Math.sqrt(sum / this.frameSamples)
      const wasTalking = this.isTalking
      if (!this.isTalking && rms >= this.startThresh) {
        this.isTalking = true
        this.silenceCount = 0
      } else if (this.isTalking) {
        if (rms >= this.stopThresh) this.silenceCount = 0
        else if (++this.silenceCount >= this.hangoverFrames) {
          this.isTalking = false
          this.silenceCount = 0
        }
      }
      const i16 = new Int16Array(this.frameSamples)
      for (let i = 0; i < this.frameSamples; i++) {
        const x = Math.max(-1, Math.min(1, frameF32[i]))
        i16[i] = x < 0 ? x * 0x8000 : x * 0x7fff
      }
      if (this.isTalking) {
        if (!wasTalking) for (const held of this.preRoll.splice(0)) this.port.postMessage(held, [held])
        this.port.postMessage(i16.buffer, [i16.buffer])
      } else if (this.preRollFrames > 0) {
        this.preRoll.push(i16.buffer)
        if (this.preRoll.length > this.preRollFrames) this.preRoll.shift()
      }
    }
  }

  resampleChunk(input) {
    const merged = new Float32Array(this.buffer.length + input.length)
    merged.set(this.buffer, 0)
    merged.set(input, this.buffer.length)
    const out = []
    while (this.pos + 1 < merged.length) {
      const i0 = Math.floor(this.pos)
      const frac = this.pos - i0
      const s0 = merged[i0]
      const s1 = merged[i0 + 1] ?? s0
      out.push(s0 + (s1 - s0) * frac)
      this.pos += this.ratio
    }
    const keepFrom = Math.max(0, Math.floor(this.pos))
    this.buffer = merged.slice(keepFrom)
    this.pos -= keepFrom
    return out
  }
}
registerProcessor(${JSON.stringify(PROCESSOR)}, AvnDictationProcessor)
`

/**
 * Encode 16 kHz mono PCM16 frames as the canonical 44-byte-header WAV the Host accepts.
 * @param chunks - kept speech frames in order.
 * @param totalSamples - sum of the frame lengths.
 * @returns complete little-endian WAV bytes.
 */
export function chunksToWav(chunks: readonly Int16Array[], totalSamples: number): Uint8Array<ArrayBuffer> {
  const dataSize = totalSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (const chunk of chunks) {
    for (const sample of chunk) { view.setInt16(offset, sample, true); offset += 2 }
  }
  return new Uint8Array(buffer)
}

/**
 * Encode the recording for the JSON Remote carrier.
 * @param bytes - complete recording.
 * @returns base64 without a data URL prefix.
 */
export function audioBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}

/** One microphone acquisition: speech frames for transcription, and an analyser for the waveform. */
export class Capture {
  private context: AudioContext | undefined
  private stream: MediaStream | undefined
  private source: MediaStreamAudioSourceNode | undefined
  private node: AudioWorkletNode | undefined
  private analyserNode: AnalyserNode | undefined
  private chunks: Int16Array[] = []
  private samples = 0
  private released = false

  /**
   * @param detection - worklet voice-detection tuning.
   * @param maxSamples - speech samples after which `onLimit` fires once.
   * @param onLimit - called when the kept speech reaches the Host's duration limit.
   */
  constructor(private readonly detection: VoiceDetection, private readonly maxSamples: number, private readonly onLimit: () => void) {}

  /** The live analyser the waveform samples; absent before `start` and after release. */
  get analyser(): AnalyserNode | undefined { return this.analyserNode }

  /**
   * Acquire the microphone and start keeping speech frames.
   * @returns after capture runs; a release during the permission prompt stops the granted tracks.
   */
  async start(): Promise<void> {
    const devices = (navigator as Partial<Navigator>).mediaDevices
    if (!devices || typeof AudioWorkletNode === 'undefined') throw new CaptureError('unavailable')
    let stream: MediaStream
    try {
      stream = await devices.getUserMedia({
        audio: { channelCount: { ideal: 1 }, autoGainControl: true, echoCancellation: true, noiseSuppression: true },
      })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') throw new CaptureError('permission')
      throw error
    }
    if (this.released) { stream.getTracks().forEach((track) => { track.stop() }); return }
    this.stream = stream
    const context = new AudioContext()
    this.context = context
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
    try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
    if (this.released) return
    this.source = context.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(context, PROCESSOR, { numberOfInputs: 1, numberOfOutputs: 0, processorOptions: this.detection })
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (this.samples >= this.maxSamples) return
      const frame = new Int16Array(event.data)
      this.chunks.push(frame)
      this.samples += frame.length
      if (this.samples >= this.maxSamples) this.onLimit()
    }
    const analyser = context.createAnalyser()
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.5
    this.analyserNode = analyser
    this.source.connect(this.node)
    this.source.connect(analyser)
  }

  /**
   * Stop listening; the waveform flattens while the recording is transcribed.
   * @returns the kept speech as WAV, or undefined when no speech was detected.
   */
  finish(): Uint8Array<ArrayBuffer> | undefined {
    this.source?.disconnect()
    this.stream?.getTracks().forEach((track) => { track.stop() })
    const kept = this.chunks.splice(0)
    return this.samples === 0 ? undefined : chunksToWav(kept, kept.reduce((sum, chunk) => sum + chunk.length, 0))
  }

  /** Release the microphone and audio graph; idempotent. */
  async release(): Promise<void> {
    if (this.released) return
    this.released = true
    this.source?.disconnect()
    if (this.node) this.node.port.onmessage = null
    this.stream?.getTracks().forEach((track) => { track.stop() })
    this.chunks = []
    const context = this.context
    this.context = undefined
    this.analyserNode = undefined
    if (context && context.state !== 'closed') await context.close()
  }
}
