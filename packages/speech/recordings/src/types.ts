/** JSON-safe shapes of saved Recorder recordings. */
import type { Branded } from '@aeven/brand'

/** A saved recording's id, the same on every device of the account. */
export type RecordingId = Branded<'RecordingId'>

/** One phrase of a saved transcript. */
export interface RecordingSegment {
  /** `me` for the microphone, `them` for the computer's audio. */
  readonly speaker: 'me' | 'them'
  /** For `them`: the recognized voice, 1-based; absent without speaker labels. */
  readonly voice?: number
  /** Start, in milliseconds from the beginning of the recording. */
  readonly offsetMs: number
  readonly text: string
}

/** The recording's audio as saved on the device that recorded it. */
export interface RecordingAudio {
  /** The container and codec, such as `audio/webm;codecs=opus`. */
  readonly mimeType: string
  readonly bytes: number
}

/** A complete saved recording. */
export interface SavedRecording {
  readonly id: RecordingId
  readonly title: string
  /** Epoch milliseconds when the recording began. */
  readonly startedAt: number
  readonly durationMs: number
  readonly segments: readonly RecordingSegment[]
  /** Absent when no audio was kept. */
  readonly audio?: RecordingAudio
  /** Epoch milliseconds of the last change, which decides between two devices' versions. */
  readonly changedAt: number
}

/** What the recordings list shows of one recording. */
export interface RecordingSummary {
  readonly id: RecordingId
  readonly title: string
  readonly startedAt: number
  readonly durationMs: number
  /** The transcript's opening words. */
  readonly preview: string
  /** Bytes of audio saved for it on the account, absent without audio. */
  readonly audioBytes?: number
  /** Whether this device holds the audio file (it may still be travelling from the recording device). */
  readonly audioHere: boolean
}
