/** Deployment configuration for the local speaker diarizer. */
/** Model location, inference, and segmentation settings. */
export interface Config {
  /** Absolute directory for the verified models. */
  dataRoot: string
  /** CPU threads for each model. */
  threads: number
  /**
   * Clustering threshold inside one recording: stretches whose voices differ by less than this
   * cosine distance join one speaker. Larger values yield fewer speakers; sherpa-onnx's 0.5 merged
   * the moderator and a panellist of a four-person panel, 0.3 kept them apart.
   */
  clusteringThreshold: number
  /** Shortest voiced stretch kept, in seconds. */
  minDurationOn: number
  /** Shortest pause that separates two stretches of one speaker, in seconds. */
  minDurationOff: number
  /** Shortest stretch given an embedding, in seconds; shorter ones join a neighbour. */
  minEmbeddingSeconds: number
  /** Minimum interval between download progress notifications. */
  progressIntervalMs: number
}
