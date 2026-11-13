/** Authenticated, cancellation-aware Client access to the speech capability. */
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, RemoteError, TypertRemoteService } from '@aeven/typert-protocol'
import type {} from '@aeven/speech-to-text'
import type {} from '@aeven/speaker-diarization'
import type {} from '@aeven/identity-user'
import { LOCAL_OWNER, recordingId, type Recordings } from '@aeven/recordings'
import type { RecordingSummary, SavedRecording } from '@aeven/recordings/types'
import type { DiarizationState, SpeakerSegment } from '@aeven/speaker-diarization/types'
import type { SpeechPreparationOptions, SpeechProviderId, SpeechSelectionPatch, Transcript } from '@aeven/speech-to-text/types'
import type {
  DiarizationRequest, RecordingAudioAppend, RecordingAudioChunk, RecordingAudioRead, RecordingRef, RecordingRename, RecordingSave,
  SpeechCatalog, TranscriptionRequest,
} from './types.ts'
import { validateWave } from '@aeven/speech-to-text/wave'

export type * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Experimental speech Remote controller. */
    speechController: SpeechController
  }
}

/** Limits applied before decoding or calling a provider. */
export interface Config {
  /** Maximum decoded WAV bytes per request. */
  maxAudioBytes: number
  /** Maximum PCM recording duration in seconds. */
  maxDurationSeconds: number
}

/** Speech calls never activate or submit to an Agent. */
export default class SpeechController extends TypertRemoteService {
  static inject = ['speechToText', 'typert']
  static Config: z<Config> = z.object({
    maxAudioBytes: z.natural().min(46).default(4 * 1024 * 1024),
    maxDurationSeconds: z.number().min(1).default(120),
  })

  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'speechController', { namespace: 'speech' })
  }

  /**
   * Read provider choices without preparing a recognizer.
   * @returns available providers, resolved default, and recording limits.
   */
  @Remote
  catalog(): SpeechCatalog {
    return { ...this.ctx.speechToText.snapshot(), ...this.config }
  }

  /**
   * Follow provider readiness independently of Session and preparation lifetimes.
   * @param signal - Client observation lifetime.
   * @returns initial and subsequent complete readiness snapshots.
   */
  @Remote({ mode: 'stream' })
  async *follow(signal: AbortSignal): AsyncIterable<SpeechCatalog> {
    for await (const snapshot of this.ctx.speechToText.follow(signal)) yield { ...snapshot, ...this.config }
  }

  /**
   * Persist the user's recognition preferences.
   * @param patch - changed preference fields.
   * @returns after preferences are saved.
   */
  @Remote
  configure(patch: SpeechSelectionPatch): Promise<void> { return this.ctx.speechToText.configure(patch) }

  /**
   * Start or join one Host-owned preparation task.
   * @param providerId - selected recognizer.
   * @param options - task-local source selection validated by the provider.
   */
  @Remote
  prepare(providerId: SpeechProviderId, options?: SpeechPreparationOptions): void { this.ctx.speechToText.prepare(providerId, options) }

  /**
   * Explicitly cancel resource preparation.
   * @param providerId - selected recognizer.
   * @returns after the preparation task settles.
   */
  @Remote
  cancelPreparation(providerId: SpeechProviderId): Promise<void> { return this.ctx.speechToText.cancelPreparation(providerId) }

  /**
   * Validate and transcribe one recording through the explicit provider selection.
   * @param request - canonical WAV encoded as base64, provider id and language hint.
   * @param signal - Client cancellation or Remote contribution disposal.
   * @returns final transcript without adding a Session event.
   */
  @Remote
  async transcribe(request: TranscriptionRequest, signal: AbortSignal): Promise<Transcript> {
    signal.throwIfAborted()
    const audio = this.decodeWave(request.audioBase64)
    try {
      const spec = this.ctx.speechToText.resolve({ audio,
        ...request.providerId === undefined ? {} : { providerId: request.providerId },
        ...request.language === undefined ? {} : { language: request.language },
      })
      return await this.ctx.speechToText.transcribe(spec, signal)
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech/transcription-failed', reason, { reason })
    }
  }

  /**
   * Read the speaker diarizer's state; `unavailable` when this Host composes no diarizer.
   * @returns the current state.
   */
  @Remote
  diarizationState(): DiarizationState {
    return this.ctx.get('speakerDiarization')?.snapshot() ?? { phase: 'unavailable', reason: 'Speaker diarization is not installed on this Host' }
  }

  /**
   * Follow the speaker diarizer's state, such as model download progress.
   * @param signal - Client observation lifetime.
   * @returns the current state, then every change.
   */
  @Remote({ mode: 'stream' })
  async *followDiarization(signal: AbortSignal): AsyncIterable<DiarizationState> {
    const diarization = this.ctx.get('speakerDiarization')
    if (diarization === undefined) {
      yield { phase: 'unavailable', reason: 'Speaker diarization is not installed on this Host' }
      return
    }
    yield* diarization.follow(signal)
  }

  /** Start or join the download of the speaker diarizer's models. */
  @Remote
  prepareDiarization(): void { this.ctx.get('speakerDiarization')?.prepare() }

  /**
   * Split one recording by voice.
   * @param request - canonical WAV encoded as base64.
   * @param signal - Client cancellation.
   * @returns stretches tiling the recording, each with a voice embedding when long enough.
   */
  @Remote
  async diarize(request: DiarizationRequest, signal: AbortSignal): Promise<SpeakerSegment[]> {
    signal.throwIfAborted()
    const diarization = this.ctx.get('speakerDiarization')
    if (diarization === undefined) throw new RemoteError('speech/diarization-failed', 'Speaker diarization is not installed on this Host', { reason: 'unavailable' })
    const audio = this.decodeWave(request.audioBase64)
    const pcm = new Int16Array(audio.buffer.slice(audio.byteOffset + 44, audio.byteOffset + audio.byteLength))
    const samples = Float32Array.from(pcm, value => value / 32768)
    try {
      return await diarization.segment(samples, signal)
    } catch (error) {
      signal.throwIfAborted()
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech/diarization-failed', reason, { reason })
    }
  }

  /**
   * List the calling account's saved recordings, newest first.
   * @returns their summaries; empty when this Host keeps no recordings.
   */
  @Remote
  async recordingsList(): Promise<RecordingSummary[]> {
    const recordings = this.ctx.get('recordings')
    return recordings === undefined ? [] : await recordings.list(this.owner())
  }

  /**
   * Read one saved recording.
   * @param request - the recording.
   * @returns the recording.
   */
  @Remote
  async recordingGet(request: RecordingRef): Promise<SavedRecording> {
    const recording = await this.recordingStore().get(this.owner(), recordingId(request.id))
    if (recording === undefined) throw new RemoteError('speech/recording-missing', 'The recording no longer exists', { reason: 'missing' })
    return recording
  }

  /**
   * Save a finished recording that holds transcribed speech.
   * @param request - the recording, with the audio uploaded before it when kept.
   * @returns the stored recording.
   */
  @Remote
  async recordingSave(request: RecordingSave): Promise<SavedRecording> {
    return await this.recordingStore().save(this.owner(), { ...request, id: recordingId(request.id) })
  }

  /**
   * Upload one chunk of a recording's audio; chunk 0 starts the file over.
   * @param request - the recording, the chunk's position, and its bytes as base64.
   */
  @Remote
  async recordingAudioAppend(request: RecordingAudioAppend): Promise<void> {
    if (!Number.isInteger(request.index) || request.index < 0) throw new RemoteError('speech/invalid-audio', 'Invalid audio chunk index', { reason: 'index' })
    await this.recordingStore().appendAudio(this.owner(), recordingId(request.id), request.index, Buffer.from(request.base64, 'base64'))
  }

  /**
   * Finish a recording's audio upload.
   * @param request - the recording.
   * @returns the audio file's size in bytes.
   */
  @Remote
  async recordingAudioFinish(request: RecordingRef): Promise<number> {
    return await this.recordingStore().finishAudio(this.owner(), recordingId(request.id))
  }

  /**
   * Read part of a recording's audio from this device.
   * @param request - the recording, the first byte, and the most bytes wanted.
   * @returns the bytes as base64 and whether the file ends there; `here: false` when this device does not hold it.
   */
  @Remote
  async recordingAudioRead(request: RecordingAudioRead): Promise<RecordingAudioChunk> {
    const length = Math.min(Math.max(1, Math.floor(request.length)), 1024 * 1024)
    const offset = Math.max(0, Math.floor(request.offset))
    const bytes = await this.recordingStore().readAudio(this.owner(), recordingId(request.id), offset, length)
    if (bytes === undefined) return { here: false, base64: '', done: true }
    return { here: true, base64: Buffer.from(bytes).toString('base64'), done: bytes.byteLength < length }
  }

  /**
   * Rename a saved recording.
   * @param request - the recording and its new title.
   * @returns the renamed recording.
   */
  @Remote
  async recordingRename(request: RecordingRename): Promise<SavedRecording> {
    return await this.recordingStore().rename(this.owner(), recordingId(request.id), request.title)
  }

  /**
   * Delete a saved recording and its audio on every device of the account.
   * @param request - the recording.
   */
  @Remote
  async recordingDelete(request: RecordingRef): Promise<void> {
    await this.recordingStore().remove(this.owner(), recordingId(request.id))
  }

  /**
   * Decode and validate one canonical WAV from the wire.
   * @param encoded - the WAV as canonical base64.
   * @returns its bytes; malformed or oversized audio throws `speech/invalid-audio`.
   */
  private decodeWave(encoded: string): Buffer {
    if (encoded.length > Math.ceil(this.config.maxAudioBytes / 3) * 4) {
      throw new RemoteError('speech/invalid-audio', 'Audio is invalid or exceeds the configured byte limit', { reason: 'encoding-or-size' })
    }
    const audio = Buffer.from(encoded, 'base64')
    try {
      if (audio.toString('base64') !== encoded) throw new Error('Audio must use canonical base64 encoding')
      if (audio.length > this.config.maxAudioBytes) throw new Error('Audio exceeds the configured byte limit')
      validateWave(audio, this.config.maxDurationSeconds)
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      throw new RemoteError('speech/invalid-audio', reason, { reason })
    }
    return audio
  }

  /** The calling account: the signed-in user, or the local owner without one. */
  private owner(): string {
    return this.ctx.get('identityUsers')?.actingUser()?.id ?? LOCAL_OWNER
  }

  private recordingStore(): Recordings {
    const recordings = this.ctx.get('recordings')
    if (recordings === undefined) throw new RemoteError('speech/recording-missing', 'Saved recordings are not installed on this Host', { reason: 'unavailable' })
    return recordings
  }
}
