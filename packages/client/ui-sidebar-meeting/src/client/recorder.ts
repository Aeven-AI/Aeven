/**
 * The one app-wide meeting recording. It outlives the pane that started it, so switching sessions
 * or pills never stops a meeting; every Recorder pill renders this same recording.
 *
 * Two sources record side by side: the microphone ("You", with Chromium's system-wide echo
 * cancellation so the call's audio playing on speakers is not heard twice) and the computer's audio
 * ("Others"). The Desktop shell answers an audio-only `getDisplayMedia` with system loopback on
 * macOS, Windows and Linux; a plain browser asks the reader to share a tab or screen with audio.
 *
 * Each source's utterances (several sentences each, see capture.ts) queue for transcription through
 * the speech Remote one at a time, in the order they ended. An utterance is always transcribed whole,
 * as dictation transcribes one whole recording, because Whisper needs the context. While the Host's
 * speaker diarizer is ready, a computer-audio utterance is also split by voice; each of Whisper's
 * timed sentences takes the voice that spoke during most of it, and each voice is matched against
 * the voices heard so far, so the others read as Speaker 1, Speaker 2, and so on. When the
 * recording finishes, every sentence is matched again against the final voices.
 *
 * Both sources are also mixed into one Opus track. A recording that ends with transcribed speech is
 * handed, with that audio, to the save callback; a discarded one is dropped.
 *
 * Under automatic language detection, Whisper guesses each utterance's language on its own and can
 * misread accented English as Welsh. The recording settles on one language once enough speech was
 * detected in it, then decodes everything in that language and decodes again, in it, the utterances
 * transcribed before it settled that came out in another language.
 */
import type { DiarizationRequest, SpeakerSegment, SpeechCatalog, TranscriptionRequest } from '@aeven/api-speech-to-text/types'
import type { Transcript } from '@aeven/speech-to-text/types'
import type { RemoteResult } from '@aeven/typert-protocol'
import { loadUtteranceWorklet, SAMPLE_RATE, UtteranceSource, wavBase64, type Utterance } from './capture.ts'

/** Who an utterance came from. */
export type Speaker = 'me' | 'them'

/** One transcribed phrase. */
export interface Segment {
  readonly id: number
  readonly speaker: Speaker
  /** Epoch milliseconds of the phrase's first sample. */
  readonly startedAt: number
  readonly text: string
  /** For the others: which voice spoke (1-based, in order of first appearance); absent without diarization. */
  readonly voice?: number
}

/** Where the computer-audio source stands for this recording. */
export type SystemAudioState = 'on' | 'unavailable' | 'denied'

/** Why a recording could not start or a phrase could not be transcribed; the pane localizes it. */
export type RecorderError =
  | { readonly kind: 'permission' | 'unavailable' | 'voiceOff' | 'voiceNotReady' }
  | { readonly kind: 'failed' | 'transcription'; readonly message: string }

/** Lifecycle of the recording. */
export type RecorderPhase = 'idle' | 'starting' | 'recording' | 'finishing' | 'done'

/** Complete observable recorder state. */
export interface RecorderSnapshot {
  readonly phase: RecorderPhase
  /** Epoch milliseconds when capture began; null before. */
  readonly startedAt: number | null
  /** Epoch milliseconds when capture stopped; null while recording. */
  readonly stoppedAt: number | null
  /** Phrases in the order they were spoken. */
  readonly segments: readonly Segment[]
  /** Utterances captured and not yet transcribed. */
  readonly pending: number
  readonly system: SystemAudioState | null
  readonly error: RecorderError | null
  /** Where saving the finished recording stands; null before it finishes or without speech. */
  readonly saved: 'saving' | 'saved' | 'failed' | null
}

/** The speech Remote calls the recorder makes. */
export interface SpeechCalls {
  catalog(): Promise<RemoteResult<SpeechCatalog>>
  transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<RemoteResult<Transcript>>
  diarize(request: DiarizationRequest, signal: AbortSignal): Promise<RemoteResult<SpeakerSegment[]>>
}

/** A voice heard in this recording: the running sum of its unit embeddings. */
interface Voice {
  readonly sum: number[]
  count: number
}

/** A diarized stretch of one utterance with the meeting voice it was matched to. */
interface LabelledStretch {
  readonly start: number
  readonly end: number
  readonly voice: number | undefined
  readonly embedding: readonly number[] | undefined
}

/** An utterance transcribed before the meeting language settled, kept until it is settled. */
interface Unsettled {
  readonly utterance: Utterance
  readonly speaker: Speaker
  readonly language: string
  readonly stretches: readonly LabelledStretch[] | undefined
  readonly ids: readonly number[]
}

/** Utterance bounds handed to each source; see UtteranceSource. */
const UTTERANCE = {
  /** Speech an utterance gathers before a pause ends it. */
  minSeconds: 8,
  /** Longest utterance; the Host's own duration limit lowers it further. */
  maxSeconds: 30,
  /** Silence that ends an utterance however short it is. */
  pauseMs: 1500,
}

/** Utterances shorter than this hold no words Whisper can recognize, only its hallucinations. */
const MIN_TRANSCRIBED_SECONDS = 0.4

/**
 * The meeting language settles once this much speech was detected in one language, and that
 * language holds at least `LANGUAGE_SHARE` of all detected speech.
 */
const LANGUAGE_SETTLE_SECONDS = 15
const LANGUAGE_SHARE = 0.6

/**
 * Cosine similarity at or above which a stretch is the same voice as one heard before. Panel and
 * call audio shares one room and one audio chain, which brings different people's voices close;
 * 0.75 separated a four-person panel that 0.5 merged.
 */
const SAME_VOICE = 0.75

/**
 * Shortest stretch, in seconds, that may found a new voice or refine a voice's profile. Shorter
 * stretches give unreliable embeddings: they join the closest known voice and leave it unchanged.
 */
const MIN_VOICE_SECONDS = 4

const IDLE: RecorderSnapshot = {
  phase: 'idle', startedAt: null, stoppedAt: null, segments: [], pending: 0, system: null, error: null, saved: null,
}

/** Audio containers tried for the saved track, in order; Chromium records WebM with Opus. */
const AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=opus', 'audio/webm']

/** Bit rate of the saved track: speech stays clear at about 15 MB an hour. */
const AUDIO_BITS_PER_SECOND = 32_000

/** Provider phases in which a transcription request is served without preparing first. */
const USABLE_PREPARATION = new Set(['ready', 'standby', 'waking'])

/**
 * Whether the page runs inside the Desktop shell, whose display-media handler answers an audio-only
 * request with system loopback.
 * @returns true in the Desktop shell.
 */
function inDesktopShell(): boolean {
  return (window as { avnDesktop?: unknown }).avnDesktop !== undefined
}

/**
 * Message of an unknown failure.
 * @param error - the thrown value.
 * @returns its message.
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Owner of the single recording: capture graph, transcription queue, and observable state. */
export class MeetingRecorder {
  private state: RecorderSnapshot = IDLE
  private readonly listeners = new Set<() => void>()
  private context: AudioContext | undefined
  private streams: MediaStream[] = []
  private sources = new Map<Speaker, UtteranceSource>()
  private queue: Promise<void> = Promise.resolve()
  private abort: AbortController | undefined
  private selection: {
    providerId: SpeechCatalog['selection']['providerId']
    language: string
    /** Language hints the selected provider accepts. */
    languages: readonly string[]
  } | undefined
  /** Seconds of speech per language Whisper detected, until the meeting language settles. */
  private spoken = new Map<string, number>()
  /** The settled meeting language; undefined before it settles or when the reader chose one. */
  private language: string | undefined
  private unsettled: Unsettled[] = []
  /** Voices heard so far, index + 1 being the voice number. */
  private voices: Voice[] = []
  /** Each labelled segment's voice embedding, for the final relabelling. */
  private embeddings = new Map<number, readonly number[]>()
  /** Bumped by every start and discard, so work from an older recording settles silently. */
  private generation = 0
  private nextSegmentId = 1
  private mediaRecorder: MediaRecorder | undefined
  /** Settles with the saved track once the media recorder stopped; undefined without one. */
  private audio: Promise<Blob | undefined> = Promise.resolve(undefined)

  /**
   * @param speech - the speech Remote calls.
   * @param diarizationReady - whether the Host's speaker diarizer can serve requests now.
   */
  constructor(
    private readonly speech: SpeechCalls,
    private readonly diarizationReady: () => boolean,
    private readonly persist: (recording: RecorderSnapshot, audio: Blob | undefined) => Promise<void>,
  ) {}

  /**
   * Read the recorder's state.
   * @returns the current state; a new object after every change.
   */
  getSnapshot = (): RecorderSnapshot => this.state

  /**
   * Observe the recorder's state.
   * @param listener - called after every state change.
   * @returns disposer removing the listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * The live level taps, for meters; absent while no source records.
   * @param speaker - the source.
   * @returns its analyser, or undefined.
   */
  analyser(speaker: Speaker): AnalyserNode | undefined {
    return this.sources.get(speaker)?.analyser
  }

  /**
   * Start a new recording, replacing a finished one.
   *
   * Computer audio is asked for before the microphone: a browser grants `getDisplayMedia` only
   * within the click's user activation, which a microphone prompt would outlast.
   * @returns after capture runs or the start failed (the failure is in the state).
   */
  async start(): Promise<void> {
    if (this.state.phase === 'starting' || this.state.phase === 'recording' || this.state.phase === 'finishing') return
    const run = ++this.generation
    this.set({ ...IDLE, phase: 'starting' })
    const devices = (navigator as Partial<Navigator>).mediaDevices
    if (devices === undefined || typeof AudioWorkletNode === 'undefined') {
      this.fail(run, { kind: 'unavailable' })
      return
    }
    try {
      const catalog = await this.speech.catalog()
      if (run !== this.generation) return
      if (!catalog.ok) { this.fail(run, { kind: 'failed', message: catalog.error.message }); return }
      const { selection, providers, maxDurationSeconds } = catalog.value
      if (!selection.enabled) { this.fail(run, { kind: 'voiceOff' }); return }
      const provider = providers.find(item => item.id === selection.providerId)
      if (provider === undefined || !USABLE_PREPARATION.has(provider.preparation.phase)) {
        this.fail(run, { kind: 'voiceNotReady' })
        return
      }
      this.selection = { providerId: selection.providerId, language: selection.language, languages: provider.languages }
      this.spoken = new Map()
      this.language = undefined
      this.unsettled = []
      this.voices = []
      this.embeddings = new Map()

      const system = await this.openSystemAudio(devices)
      if (run !== this.generation) { system.stream?.getTracks().forEach((track) => { track.stop() }); return }
      let mic: MediaStream
      try {
        mic = await devices.getUserMedia({
          audio: {
            channelCount: { ideal: 1 },
            // 'all' cancels everything the computer plays, not only this page's
            // own output; browsers without it fall back to the boolean.
            echoCancellation: { ideal: 'all' } as unknown as ConstrainBoolean,
            noiseSuppression: true,
            autoGainControl: true,
          },
        })
      } catch (error) {
        system.stream?.getTracks().forEach((track) => { track.stop() })
        if (error instanceof DOMException && error.name === 'NotAllowedError') this.fail(run, { kind: 'permission' })
        else this.fail(run, { kind: 'failed', message: messageOf(error) })
        return
      }
      if (run !== this.generation) {
        mic.getTracks().forEach((track) => { track.stop() })
        system.stream?.getTracks().forEach((track) => { track.stop() })
        return
      }
      this.streams = system.stream === undefined ? [mic] : [mic, system.stream]
      const context = new AudioContext()
      this.context = context
      await loadUtteranceWorklet(context)
      if (run !== this.generation) return
      const limits = {
        minSamples: UTTERANCE.minSeconds * SAMPLE_RATE,
        maxSamples: Math.min(UTTERANCE.maxSeconds, maxDurationSeconds) * SAMPLE_RATE,
        pauseMs: UTTERANCE.pauseMs,
      }
      this.abort = new AbortController()
      this.sources.set('me', new UtteranceSource(context, mic, limits, (utterance) => { this.enqueue(run, 'me', utterance) }))
      if (system.stream !== undefined) {
        const them = new UtteranceSource(context, system.stream, limits, (utterance) => { this.enqueue(run, 'them', utterance) })
        this.sources.set('them', them)
        // A shared tab or screen the reader stops sharing ends the system track; the microphone keeps recording.
        for (const track of system.stream.getAudioTracks()) {
          track.addEventListener('ended', () => {
            if (run !== this.generation) return
            this.sources.get('them')?.close()
            this.sources.delete('them')
            this.set({ ...this.state, system: 'denied' })
          })
        }
      }
      this.captureAudio(context, this.streams)
      this.set({ ...this.state, phase: 'recording', startedAt: Date.now(), system: system.state })
    } catch (error) {
      this.fail(run, { kind: 'failed', message: messageOf(error) })
    }
  }

  /** Stop capturing; phrases already captured still transcribe, then the recording is done. */
  stop(): void {
    if (this.state.phase !== 'recording') return
    const run = this.generation
    for (const source of this.sources.values()) source.close()
    const recorder = this.mediaRecorder
    this.mediaRecorder = undefined
    if (recorder !== undefined && recorder.state !== 'inactive') recorder.stop()
    const audio = this.audio
    // The capture graph stays up until the media recorder delivered its last data.
    void audio.then(() => { if (run === this.generation) this.release() })
    this.set({ ...this.state, phase: 'finishing', stoppedAt: Date.now() })
    void Promise.all([this.queue, audio]).then(([, track]) => {
      if (run !== this.generation) return
      const segments = this.relabel(this.state.segments)
      const speech = segments.some(segment => segment.text.trim() !== '')
      this.set({ ...this.state, phase: 'done', segments, saved: speech ? 'saving' : null })
      if (!speech) return
      this.persist(this.state, track).then(
        () => { if (run === this.generation) this.set({ ...this.state, saved: 'saved' }) },
        (error: unknown) => { if (run === this.generation) this.set({ ...this.state, saved: 'failed', error: { kind: 'failed', message: messageOf(error) } }) },
      )
    })
  }

  /** Drop the recording, its pending phrases, and its transcript. */
  discard(): void {
    this.generation += 1
    this.stopAudio()
    for (const source of this.sources.values()) source.drop()
    this.release()
    this.abort?.abort(new Error('Meeting recording discarded'))
    this.abort = undefined
    this.queue = Promise.resolve()
    this.unsettled = []
    this.set(IDLE)
  }

  /** Release capture on plugin disposal. */
  dispose(): void {
    this.discard()
    this.listeners.clear()
  }

  private async openSystemAudio(devices: MediaDevices): Promise<{ stream?: MediaStream; state: SystemAudioState }> {
    if (typeof devices.getDisplayMedia !== 'function') return { state: 'unavailable' }
    try {
      // The Desktop shell answers audio-only requests with system loopback and
      // no picker. A browser requires video, so the reader picks the meeting's
      // tab or screen; the video track is dropped at once.
      const desktop = inDesktopShell()
      const stream = await devices.getDisplayMedia({
        video: !desktop,
        // `restrictOwnAudio` keeps Aeven's own read-aloud out of the meeting
        // audio where supported. Voice processing stays off: Chromium applies
        // it to loopback tracks by default, and it would treat the far end's
        // voices as echo and noise.
        audio: {
          restrictOwnAudio: true, echoCancellation: false, noiseSuppression: false, autoGainControl: false,
        } as MediaTrackConstraints,
      })
      for (const track of stream.getVideoTracks()) { track.stop(); stream.removeTrack(track) }
      if (stream.getAudioTracks().length === 0) return { state: 'unavailable' }
      return { stream, state: 'on' }
    } catch (error) {
      return { state: error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied' : 'unavailable' }
    }
  }

  private enqueue(run: number, speaker: Speaker, utterance: Utterance): void {
    if (run !== this.generation || (utterance.wav.byteLength - 44) / 2 < MIN_TRANSCRIBED_SECONDS * SAMPLE_RATE) return
    const signal = this.abort?.signal
    if (this.selection === undefined || signal === undefined) return
    this.set({ ...this.state, pending: this.state.pending + 1 })
    this.queue = this.queue.then(async () => {
      if (run !== this.generation) return
      try {
        const diarizing = speaker === 'them' && this.diarizationReady() ? this.diarize(utterance, signal) : undefined
        const [decoded, stretches] = await Promise.all([this.transcribe(run, utterance, signal), diarizing])
        if (run !== this.generation || decoded === undefined) return
        const labelled = stretches === undefined ? undefined : this.label(stretches)
        const segments = this.segmentsOf(utterance, speaker, decoded.transcript, labelled)
        if (decoded.language !== undefined && this.language === undefined && this.selection?.language === 'auto') {
          const ids = segments.map(segment => segment.id)
          this.unsettled.push({ utterance, speaker, language: decoded.language, stretches: labelled, ids })
        }
        this.set({ ...this.state, segments: [...this.state.segments, ...segments].sort((a, b) => a.startedAt - b.startedAt) })
        await this.settle(run, signal)
      } catch (error) {
        if (run === this.generation) this.set({ ...this.state, error: { kind: 'transcription', message: messageOf(error) } })
      } finally {
        if (run === this.generation) this.set({ ...this.state, pending: this.state.pending - 1 })
      }
    })
  }

  /**
   * Split an utterance by voice; a failed diarization leaves it unlabelled.
   * @param utterance - the computer-audio utterance.
   * @param signal - recording cancellation.
   * @returns its stretches, or undefined when diarization failed.
   */
  private async diarize(utterance: Utterance, signal: AbortSignal): Promise<readonly SpeakerSegment[] | undefined> {
    const result = await this.speech.diarize({ audioBase64: wavBase64(utterance.wav) }, signal)
    return result.ok ? result.value : undefined
  }

  /**
   * Transcribe a whole utterance in the meeting's language once it settled, else in the reader's
   * selection (automatic detection by default).
   * @param run - the recording generation the request belongs to.
   * @param utterance - the audio.
   * @param signal - recording cancellation.
   * @param language - decode in this language instead.
   * @returns the transcript and the language Whisper reported; undefined after a failure (recorded in
   *   the state) or a newer recording.
   */
  private async transcribe(
    run: number, utterance: Utterance, signal: AbortSignal, language?: string,
  ): Promise<{ transcript: Transcript; language: string | undefined } | undefined> {
    const selection = this.selection
    if (selection === undefined) return undefined
    const result = await this.speech.transcribe({
      audioBase64: wavBase64(utterance.wav), providerId: selection.providerId, language: language ?? this.language ?? selection.language,
    }, signal)
    if (run !== this.generation) return undefined
    if (!result.ok) {
      this.set({ ...this.state, error: { kind: 'transcription', message: result.error.message } })
      return undefined
    }
    const detected = result.value.language
    if (detected !== undefined && language === undefined && this.language === undefined && result.value.text.trim() !== '') {
      this.spoken.set(detected, (this.spoken.get(detected) ?? 0) + result.value.audioSeconds)
    }
    return { transcript: result.value, language: detected }
  }

  /**
   * Settle the meeting language once enough speech was detected in one language, then decode again
   * in it every utterance transcribed before that came out in another language, replacing its
   * segments. The kept audio is released either way.
   * @param run - the recording generation.
   * @param signal - recording cancellation.
   */
  private async settle(run: number, signal: AbortSignal): Promise<void> {
    const selection = this.selection
    if (this.language === undefined && selection?.language === 'auto') {
      const total = [...this.spoken.values()].reduce((sum, seconds) => sum + seconds, 0)
      for (const [language, seconds] of this.spoken) {
        if (seconds >= LANGUAGE_SETTLE_SECONDS && seconds / total >= LANGUAGE_SHARE && selection.languages.includes(language)) {
          this.language = language
        }
      }
    }
    const language = this.language
    if (language === undefined) return
    const pending = this.unsettled
    this.unsettled = []
    for (const entry of pending) {
      if (entry.language === language) continue
      const decoded = await this.transcribe(run, entry.utterance, signal, language)
      if (run !== this.generation || decoded === undefined) return
      const replacement = this.segmentsOf(entry.utterance, entry.speaker, decoded.transcript, entry.stretches)
      const replaced = new Set(entry.ids)
      const segments = [...this.state.segments.filter(segment => !replaced.has(segment.id)), ...replacement]
        .sort((a, b) => a.startedAt - b.startedAt)
      this.set({ ...this.state, segments })
    }
  }

  /**
   * Match each diarized stretch to a meeting voice; a stretch too short to embed takes its
   * neighbour's voice.
   * @param stretches - the utterance's stretches, in order.
   * @returns the stretches with their voices.
   */
  private label(stretches: readonly SpeakerSegment[]): LabelledStretch[] {
    const labelled: LabelledStretch[] = stretches.map(stretch => ({
      start: stretch.start, end: stretch.end, embedding: stretch.embedding,
      voice: stretch.embedding === undefined ? undefined : this.match(stretch.embedding, stretch.end - stretch.start),
    }))
    return labelled.map((stretch, index) => stretch.voice !== undefined ? stretch
      : { ...stretch, voice: labelled[index - 1]?.voice ?? labelled.find(other => other.voice !== undefined)?.voice })
  }

  /**
   * Turn one transcribed utterance into segments: each of Whisper's timed sentences takes the voice of
   * the stretch it overlaps most, and consecutive sentences of one voice join one segment.
   * @param utterance - the audio's start time.
   * @param speaker - the source.
   * @param transcript - Whisper's text and timed sentences.
   * @param stretches - the labelled voice stretches, when diarized.
   * @returns the segments, with fresh ids.
   */
  private segmentsOf(
    utterance: Utterance, speaker: Speaker, transcript: Transcript, stretches: readonly LabelledStretch[] | undefined,
  ): Segment[] {
    const sentences = transcript.segments !== undefined && transcript.segments.length > 0
      ? transcript.segments
      : [{ start: 0, end: transcript.audioSeconds, text: transcript.text }]
    const runs: { start: number; text: string; stretch: LabelledStretch | undefined }[] = []
    for (const sentence of sentences) {
      const text = sentence.text.trim()
      if (text === '') continue
      const stretch = stretches === undefined ? undefined : dominant(stretches, sentence.start, sentence.end)
      const last = runs.at(-1)
      if (last !== undefined && last.stretch?.voice === stretch?.voice) last.text = `${last.text} ${text}`
      else runs.push({ start: sentence.start, text, stretch })
    }
    return runs.map((run) => {
      const id = this.nextSegmentId++
      if (run.stretch?.embedding !== undefined) this.embeddings.set(id, run.stretch.embedding)
      return {
        id, speaker, startedAt: utterance.startedAt + Math.round(run.start * 1000), text: run.text,
        ...run.stretch?.voice === undefined ? {} : { voice: run.stretch.voice },
      }
    })
  }

  /**
   * The voice an embedding belongs to, adding a new voice when none is close enough and the stretch is
   * long enough to trust.
   * @param embedding - a unit-length voice embedding.
   * @param seconds - the length of the stretch it was computed from.
   * @returns the 1-based voice number.
   */
  private match(embedding: readonly number[], seconds: number): number {
    const best = this.nearest(embedding)
    const trusted = seconds >= MIN_VOICE_SECONDS
    if (best !== undefined && (best.similarity >= SAME_VOICE || !trusted)) {
      if (trusted) {
        const voice = this.voices[best.index]
        if (voice !== undefined) {
          for (const [i, value] of embedding.entries()) voice.sum[i] = (voice.sum[i] ?? 0) + value
          voice.count += 1
        }
      }
      return best.index + 1
    }
    this.voices.push({ sum: [...embedding], count: 1 })
    return this.voices.length
  }

  /**
   * The closest voice heard so far.
   * @param embedding - a unit-length voice embedding.
   * @returns its index and cosine similarity, or undefined before any voice.
   */
  private nearest(embedding: readonly number[]): { index: number; similarity: number } | undefined {
    let best: { index: number; similarity: number } | undefined
    for (const [index, voice] of this.voices.entries()) {
      let dot = 0, norm = 0
      for (const [i, value] of embedding.entries()) {
        const sum = voice.sum[i] ?? 0
        dot += sum * value
        norm += sum * sum
      }
      const similarity = dot / (Math.sqrt(norm) || 1)
      if (best === undefined || similarity > best.similarity) best = { index, similarity }
    }
    return best
  }

  /**
   * Match every labelled segment against the final voices and renumber them by first appearance.
   * @param segments - the finished transcript.
   * @returns the relabelled transcript.
   */
  private relabel(segments: readonly Segment[]): Segment[] {
    const assigned = segments.map((segment) => {
      const embedding = this.embeddings.get(segment.id)
      const nearest = embedding === undefined ? undefined : this.nearest(embedding)
      return nearest === undefined ? segment : { ...segment, voice: nearest.index + 1 }
    })
    const order = new Map<number, number>()
    return assigned.map((segment) => {
      if (segment.voice === undefined) return segment
      let number = order.get(segment.voice)
      if (number === undefined) { number = order.size + 1; order.set(segment.voice, number) }
      return { ...segment, voice: number }
    })
  }

  /**
   * Record both sources, mixed, as one compressed track for saving.
   * @param context - the recording's audio context.
   * @param streams - the microphone and, when captured, the computer audio.
   */
  private captureAudio(context: AudioContext, streams: readonly MediaStream[]): void {
    if (typeof MediaRecorder === 'undefined') { this.audio = Promise.resolve(undefined); return }
    const mix = context.createMediaStreamDestination()
    for (const stream of streams) context.createMediaStreamSource(stream).connect(mix)
    const mimeType = AUDIO_TYPES.find(type => MediaRecorder.isTypeSupported(type))
    const options: MediaRecorderOptions = { ...mimeType === undefined ? {} : { mimeType }, audioBitsPerSecond: AUDIO_BITS_PER_SECOND }
    const recorder = new MediaRecorder(mix.stream, options)
    const chunks: Blob[] = []
    recorder.ondataavailable = (event) => { if (event.data.size > 0) chunks.push(event.data) }
    this.audio = new Promise((resolve) => {
      recorder.onstop = () => { resolve(new Blob(chunks, { type: recorder.mimeType })) }
      recorder.onerror = () => { resolve(undefined) }
    })
    recorder.start(1000)
    this.mediaRecorder = recorder
  }

  /** Stop the media recorder and drop its track. */
  private stopAudio(): void {
    const recorder = this.mediaRecorder
    this.mediaRecorder = undefined
    if (recorder !== undefined && recorder.state !== 'inactive') {
      recorder.ondataavailable = null
      recorder.stop()
    }
    this.audio = Promise.resolve(undefined)
  }

  private fail(run: number, error: RecorderError): void {
    if (run !== this.generation) return
    this.stopAudio()
    for (const source of this.sources.values()) source.drop()
    this.release()
    this.set({ ...IDLE, error })
  }

  private release(): void {
    this.sources.clear()
    for (const stream of this.streams) stream.getTracks().forEach((track) => { track.stop() })
    this.streams = []
    const context = this.context
    this.context = undefined
    if (context !== undefined && context.state !== 'closed') void context.close()
  }

  private set(next: RecorderSnapshot): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

/**
 * The stretch overlapping a time range the most.
 * @param stretches - the utterance's labelled stretches.
 * @param start - range start, in seconds.
 * @param end - range end, in seconds.
 * @returns that stretch, or the nearest one when none overlaps.
 */
function dominant(stretches: readonly LabelledStretch[], start: number, end: number): LabelledStretch | undefined {
  let best: LabelledStretch | undefined
  let overlap = -Infinity
  for (const stretch of stretches) {
    const shared = Math.min(end, stretch.end) - Math.max(start, stretch.start)
    if (shared > overlap) { overlap = shared; best = stretch }
  }
  return best
}
