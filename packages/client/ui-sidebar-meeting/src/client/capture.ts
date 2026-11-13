/**
 * Utterance capture for one audio source. An AudioWorklet high-passes the
 * source, low-passes it below the 16 kHz Nyquist limit and resamples it to
 * 16 kHz, cuts it into 20 ms frames, and marks talking
 * with an RMS detector (hysteresis, hangover, pre-roll); only talking frames
 * leave the worklet. The main thread collects them into utterances of several
 * sentences, as dictation hands Whisper one whole recording: an utterance ends
 * at a pause once it holds `minSamples` of speech, at a long pause however
 * short it is, or at its length cap. Whisper needs that context to recognize
 * the language and the words reliably.
 */

/** Sample rate of every utterance handed to transcription. */
export const SAMPLE_RATE = 16_000

/** Voice-detection tuning handed to the worklet; RMS thresholds are linear amplitudes. */
export interface VoiceDetection {
  /** Frame RMS at or above which talking starts. */
  readonly startThreshold: number
  /** Frame RMS below which talking may stop; lower than `startThreshold`. */
  readonly stopThreshold: number
  /** Silence that ends an utterance; longer than dictation's so a phrase is not split at a breath. */
  readonly hangoverMs: number
  /** Audio kept before each talking onset. */
  readonly preRollMs: number
  /** One-pole high-pass cutoff removing rumble and DC before detection. */
  readonly highPassHz: number
}

/** Meeting defaults: dictation's thresholds with a phrase-length hangover. */
export const MEETING_VOICE_DETECTION: VoiceDetection = {
  startThreshold: 0.02, stopThreshold: 0.012, hangoverMs: 700, preRollMs: 250, highPassHz: 70,
}

const PROCESSOR = 'avn-meeting-utterances'

// Runs in the AudioWorkletGlobalScope; shipped as source so the page needs no asset route.
// Posts an ArrayBuffer per talking frame and the string 'end' when talking stops.
const WORKLET_SOURCE = `
class AvnMeetingProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()
    const o = options.processorOptions
    this.ratio = sampleRate / ${String(SAMPLE_RATE)}
    this.buffer = new Float32Array(0)
    this.pos = 0
    this.frameSamples = ${String(SAMPLE_RATE / 50)}
    this.accum = []
    this.startThresh = o.startThreshold
    this.stopThresh = o.stopThreshold
    this.hangoverFrames = Math.max(1, Math.round(o.hangoverMs / 20))
    this.preRollFrames = Math.max(0, Math.round(o.preRollMs / 20))
    const rc = 1 / (2 * Math.PI * o.highPassHz)
    this.hpA = rc / (rc + 1 / sampleRate)
    this.hpPrevIn = 0
    this.hpPrevOut = 0
    // Anti-aliasing: a 63-tap Hamming-windowed sinc low-pass at 7.2 kHz before
    // the linear resampler. Without it, everything between 8 kHz and the device
    // rate folds back into the speech band and blurs voices together, which
    // makes different speakers' voice embeddings look alike.
    this.taps = []
    if (sampleRate > ${String(SAMPLE_RATE)}) {
      const count = 63, cutoff = 7200 / sampleRate
      let sum = 0
      for (let n = 0; n < count; n++) {
        const m = n - (count - 1) / 2
        const ideal = m === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * m) / (Math.PI * m)
        const tap = ideal * (0.54 - 0.46 * Math.cos(2 * Math.PI * n / (count - 1)))
        this.taps.push(tap)
        sum += tap
      }
      for (let n = 0; n < count; n++) this.taps[n] /= sum
    }
    this.history = new Float32Array(Math.max(0, this.taps.length - 1))
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
    const resampled = this.resampleChunk(this.lowPass(mono))
    for (let i = 0; i < resampled.length; i++) this.accum.push(resampled[i])
    this.flushFrames()
    return true
  }

  flushFrames() {
    while (this.accum.length >= this.frameSamples) {
      const frame = this.accum.splice(0, this.frameSamples)
      let sum = 0
      for (let i = 0; i < this.frameSamples; i++) sum += frame[i] * frame[i]
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
        const x = Math.max(-1, Math.min(1, frame[i]))
        i16[i] = x < 0 ? x * 0x8000 : x * 0x7fff
      }
      if (this.isTalking) {
        if (!wasTalking) for (const held of this.preRoll.splice(0)) this.port.postMessage(held, [held])
        this.port.postMessage(i16.buffer, [i16.buffer])
      } else {
        if (wasTalking) this.port.postMessage('end')
        if (this.preRollFrames > 0) {
          this.preRoll.push(i16.buffer)
          if (this.preRoll.length > this.preRollFrames) this.preRoll.shift()
        }
      }
    }
  }

  lowPass(input) {
    const count = this.taps.length
    if (count === 0) return input
    const merged = new Float32Array(count - 1 + input.length)
    merged.set(this.history, 0)
    merged.set(input, count - 1)
    const out = new Float32Array(input.length)
    for (let i = 0; i < input.length; i++) {
      let acc = 0
      for (let n = 0; n < count; n++) acc += this.taps[n] * merged[i + count - 1 - n]
      out[i] = acc
    }
    this.history = merged.slice(merged.length - (count - 1))
    return out
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
registerProcessor(${JSON.stringify(PROCESSOR)}, AvnMeetingProcessor)
`

/**
 * Load the utterance worklet into an audio context once.
 * @param context - the recording's audio context.
 * @returns after the processor is registered.
 */
export async function loadUtteranceWorklet(context: AudioContext): Promise<void> {
  const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }))
  try { await context.audioWorklet.addModule(url) } finally { URL.revokeObjectURL(url) }
}

/** One finished utterance. */
export interface Utterance {
  /** Canonical 16 kHz mono PCM16 WAV. */
  readonly wav: Uint8Array<ArrayBuffer>
  /** Wall-clock time of the utterance's first kept sample, in epoch milliseconds. */
  readonly startedAt: number
}

/** One live source feeding utterances: a microphone or the computer's audio. */
export class UtteranceSource {
  private readonly source: MediaStreamAudioSourceNode
  private readonly node: AudioWorkletNode
  /** Live level tap for the pane's meters. */
  readonly analyser: AnalyserNode
  private frames: Int16Array[] = []
  private samples = 0
  private startedAt = 0
  private pauseTimer: ReturnType<typeof setTimeout> | undefined

  /**
   * @param context - the recording's audio context, with the worklet loaded.
   * @param stream - the source's media stream; its tracks stay owned by the caller.
   * @param limits - utterance bounds: `minSamples` of speech before a pause ends it, `maxSamples` at which
   *   it is cut, and `pauseMs` of silence that ends it regardless of length.
   * @param onUtterance - receives each finished utterance.
   */
  constructor(
    context: AudioContext,
    stream: MediaStream,
    private readonly limits: { readonly minSamples: number; readonly maxSamples: number; readonly pauseMs: number },
    private readonly onUtterance: (utterance: Utterance) => void,
  ) {
    this.source = context.createMediaStreamSource(stream)
    this.node = new AudioWorkletNode(context, PROCESSOR, {
      numberOfInputs: 1, numberOfOutputs: 0, processorOptions: MEETING_VOICE_DETECTION,
    })
    this.node.port.onmessage = (event: MessageEvent<ArrayBuffer | 'end'>) => {
      if (event.data === 'end') {
        if (this.samples >= this.limits.minSamples) this.flush()
        else this.pauseTimer ??= setTimeout(() => { this.flush() }, this.limits.pauseMs)
        return
      }
      clearTimeout(this.pauseTimer)
      this.pauseTimer = undefined
      const frame = new Int16Array(event.data)
      if (this.samples === 0) this.startedAt = Date.now() - MEETING_VOICE_DETECTION.preRollMs
      this.frames.push(frame)
      this.samples += frame.length
      if (this.samples >= this.limits.maxSamples) this.flush()
    }
    this.analyser = context.createAnalyser()
    this.analyser.fftSize = 512
    this.analyser.smoothingTimeConstant = 0.6
    this.source.connect(this.node)
    this.source.connect(this.analyser)
  }

  /** Hand over the utterance in progress, if any. */
  flush(): void {
    clearTimeout(this.pauseTimer)
    this.pauseTimer = undefined
    if (this.samples === 0) return
    const frames = this.frames
    const samples = this.samples
    this.frames = []
    this.samples = 0
    this.onUtterance({ wav: framesToWav(frames, samples), startedAt: this.startedAt })
  }

  /** Disconnect from the graph; the utterance in progress is handed over first. */
  close(): void {
    this.source.disconnect()
    this.node.port.onmessage = null
    this.flush()
  }

  /** Disconnect without handing over the utterance in progress. */
  drop(): void {
    clearTimeout(this.pauseTimer)
    this.pauseTimer = undefined
    this.frames = []
    this.samples = 0
    this.source.disconnect()
    this.node.port.onmessage = null
  }
}

/* jscpd:ignore-start -- the canonical WAV the Host's validateWave accepts; dictation's capture writes the same header. */
/**
 * Encode 16 kHz mono PCM16 frames as the canonical 44-byte-header WAV the Host accepts.
 * @param frames - kept frames in order.
 * @param totalSamples - sum of the frame lengths.
 * @returns complete little-endian WAV bytes.
 */
function framesToWav(frames: readonly Int16Array[], totalSamples: number): Uint8Array<ArrayBuffer> {
  const dataSize = totalSamples * 2
  const buffer = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buffer)
  const text = (at: number, value: string): void => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); text(8, 'WAVE'); text(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true); view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data')
  view.setUint32(40, dataSize, true)
  let offset = 44
  for (const frame of frames) {
    for (const sample of frame) { view.setInt16(offset, sample, true); offset += 2 }
  }
  return new Uint8Array(buffer)
}
/* jscpd:ignore-end */

/**
 * Encode bytes for the JSON Remote carrier: an utterance WAV or a chunk of the saved audio.
 * @param bytes - the bytes.
 * @returns base64 without a data URL prefix.
 */
export function wavBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  return btoa(text)
}
