/** Deployment configuration for saved recordings. */
/** Storage settings. */
export interface Config {
  /** Absolute directory holding each account's recordings and audio. */
  dataRoot: string
  /** Largest audio file accepted for one recording, in bytes. */
  maxAudioBytes: number
}
