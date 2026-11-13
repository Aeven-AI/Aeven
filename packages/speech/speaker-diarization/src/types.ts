/** JSON-safe state and results of the speaker diarization capability. */

/** Where the local diarizer stands; every phase is a complete observation. */
export type DiarizationState =
  /** This Host cannot run the diarizer (no native runtime for its platform). */
  | { readonly phase: 'unavailable'; readonly reason: string }
  /** The models are not on disk yet; `prepare` downloads them. */
  | { readonly phase: 'unprepared'; readonly totalBytes: number }
  /** Inspecting or verifying files on disk. */
  | { readonly phase: 'checking' }
  /** Downloading the models; bytes count across both files. */
  | { readonly phase: 'downloading'; readonly completedBytes: number; readonly totalBytes: number }
  /** Models verified; segmentation requests are served. */
  | { readonly phase: 'ready' }
  /** The last preparation failed; `prepare` retries. */
  | { readonly phase: 'failed'; readonly message: string }

/** One stretch of a single voice inside a recording. */
export interface SpeakerSegment {
  /** Start, in seconds from the beginning of the submitted audio. */
  readonly start: number
  /** End, in seconds from the beginning of the submitted audio. */
  readonly end: number
  /**
   * The voice's embedding (unit length), comparable by dot product with embeddings from other
   * recordings of the same Host; absent when the stretch is too short to embed.
   */
  readonly embedding?: readonly number[]
}
