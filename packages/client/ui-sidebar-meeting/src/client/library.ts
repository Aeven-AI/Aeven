/**
 * The browser side of saved recordings: saves a finished recording through the speech Remote
 * (audio first, in chunks, then the transcript), and lists, reads, renames, and deletes them. Panes
 * subscribe to learn when the list changed through this library.
 */
import type {
  RecordingAudioAppend, RecordingAudioChunk, RecordingAudioRead, RecordingId, RecordingRef, RecordingRename, RecordingSave,
  RecordingSummary, SavedRecording,
} from '@aeven/api-speech-to-text/types'
import type { RemoteResult } from '@aeven/typert-protocol'
import { wavBase64 } from './capture.ts'

/** The speech Remote calls the library makes. */
export interface RecordingCalls {
  recordingsList(): Promise<RemoteResult<RecordingSummary[]>>
  recordingGet(request: RecordingRef): Promise<RemoteResult<SavedRecording>>
  recordingSave(request: RecordingSave): Promise<RemoteResult<SavedRecording>>
  recordingAudioAppend(request: RecordingAudioAppend): Promise<RemoteResult<void>>
  recordingAudioFinish(request: RecordingRef): Promise<RemoteResult<number>>
  recordingAudioRead(request: RecordingAudioRead): Promise<RemoteResult<RecordingAudioChunk>>
  recordingRename(request: RecordingRename): Promise<RemoteResult<SavedRecording>>
  recordingDelete(request: RecordingRef): Promise<RemoteResult<void>>
}

/** Raw audio bytes per upload or download request; base64 grows them by a third on the wire. */
const CHUNK_BYTES = 512 * 1024

/**
 * Unwrap a Remote result.
 * @param result - the result.
 * @returns its value; a failure throws its message.
 */
function value<T>(result: RemoteResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.value
}

/** Saved recordings for the signed-in account. */
export class RecordingLibrary {
  private readonly listeners = new Set<() => void>()
  /** Bumped after every change made through this library. */
  version = 0

  /** @param calls - the speech Remote calls. */
  constructor(private readonly calls: RecordingCalls) {}

  /**
   * Observe changes made through this library.
   * @param listener - called after every change made through this library.
   * @returns disposer removing the listener.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /**
   * Read the change counter.
   * @returns the counter, for `useSyncExternalStore`.
   */
  getSnapshot = (): number => this.version

  /**
   * List the account's recordings.
   * @returns their summaries, newest first.
   */
  async list(): Promise<RecordingSummary[]> { return value(await this.calls.recordingsList()) }

  /**
   * Read one recording.
   * @param id - the recording.
   * @returns the full recording.
   */
  async get(id: RecordingId): Promise<SavedRecording> { return value(await this.calls.recordingGet({ id })) }

  /**
   * Save a finished recording: its audio first, when kept, then the transcript.
   * @param recording - the recording without its audio description.
   * @param audio - the recorded audio, if any.
   * @returns the stored recording.
   */
  async save(recording: Omit<RecordingSave, 'audio'>, audio: Blob | undefined): Promise<SavedRecording> {
    let stored: RecordingSave = recording
    if (audio !== undefined && audio.size > 0) {
      const bytes = new Uint8Array(await audio.arrayBuffer())
      for (let index = 0, offset = 0; offset < bytes.length; index++, offset += CHUNK_BYTES) {
        const base64 = wavBase64(bytes.subarray(offset, offset + CHUNK_BYTES))
        value(await this.calls.recordingAudioAppend({ id: recording.id, index, base64 }))
      }
      const size = value(await this.calls.recordingAudioFinish({ id: recording.id }))
      stored = { ...recording, audio: { mimeType: audio.type || 'audio/webm', bytes: size } }
    }
    const saved = value(await this.calls.recordingSave(stored))
    this.changed()
    return saved
  }

  /**
   * Load a recording's audio from this device.
   * @param recording - the recording.
   * @returns an object URL the caller revokes, or undefined when this device does not hold the audio.
   */
  async audioUrl(recording: SavedRecording): Promise<string | undefined> {
    if (recording.audio === undefined) return undefined
    const parts: BlobPart[] = []
    for (let offset = 0; ; offset += CHUNK_BYTES) {
      const chunk = value(await this.calls.recordingAudioRead({ id: recording.id, offset, length: CHUNK_BYTES }))
      if (!chunk.here) return undefined
      const binary = atob(chunk.base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      parts.push(bytes)
      if (chunk.done) break
    }
    return URL.createObjectURL(new Blob(parts, { type: recording.audio.mimeType }))
  }

  /**
   * Rename a recording.
   * @param id - the recording.
   * @param title - the new title.
   * @returns the renamed recording.
   */
  async rename(id: RecordingId, title: string): Promise<SavedRecording> {
    const renamed = value(await this.calls.recordingRename({ id, title }))
    this.changed()
    return renamed
  }

  /**
   * Delete a recording on every device of the account.
   * @param id - the recording.
   */
  async remove(id: RecordingId): Promise<void> {
    value(await this.calls.recordingDelete({ id }))
    this.changed()
  }

  private changed(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}
