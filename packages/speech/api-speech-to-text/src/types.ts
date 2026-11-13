/** JSON-safe inputs and results of the experimental speech Remote namespace. */
import type { SpeechProviderId, SpeechSnapshot } from '@aeven/speech-to-text/types'
export type { DiarizationState, SpeakerSegment } from '@aeven/speaker-diarization/types'
export type { RecordingAudio, RecordingId, RecordingSegment, RecordingSummary, SavedRecording } from '@aeven/recordings/types'
import type { RecordingId, SavedRecording } from '@aeven/recordings/types'
import type {} from '@aeven/typert-protocol'

declare module '@aeven/typert-protocol' {
  interface RemoteErrorDetailsMap {
    /** Audio encoding or intake limits prevented transcription. */
    'speech/invalid-audio': { readonly reason: string }
    /** The selected provider rejected transcription. */
    'speech/transcription-failed': { readonly reason: string }
    /** The speaker diarizer could not split the recording. */
    'speech/diarization-failed': { readonly reason: string }
    /** The saved recording does not exist, or this Host keeps none. */
    'speech/recording-missing': { readonly reason: string }
  }
}

/** Complete recording submitted for transcription, separate from Session admission. */
export interface TranscriptionRequest {
  readonly audioBase64: string
  readonly providerId?: SpeechProviderId
  readonly language?: string
}

/** Current provider choices and audio intake limits. */
export interface SpeechCatalog extends SpeechSnapshot {
  readonly maxAudioBytes: number
  readonly maxDurationSeconds: number
}

/** Complete recording submitted for speaker diarization. */
export interface DiarizationRequest {
  readonly audioBase64: string
}

/** Names one saved recording. */
export interface RecordingRef {
  readonly id: RecordingId
}

/** A finished recording to save; the Host sets `changedAt`. */
export type RecordingSave = Omit<SavedRecording, 'changedAt'>

/** One chunk of a recording's audio upload. */
export interface RecordingAudioAppend {
  readonly id: RecordingId
  /** The chunk's position, from 0; chunk 0 starts the file over. */
  readonly index: number
  readonly base64: string
}

/** A range of a recording's audio to read. */
export interface RecordingAudioRead {
  readonly id: RecordingId
  readonly offset: number
  readonly length: number
}

/** A range of a recording's audio as read. */
export interface RecordingAudioChunk {
  /** Whether this device holds the audio file. */
  readonly here: boolean
  readonly base64: string
  /** Whether the file ends within this chunk. */
  readonly done: boolean
}

/** A recording's new title. */
export interface RecordingRename {
  readonly id: RecordingId
  readonly title: string
}
