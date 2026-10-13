/** Deployment configuration for the managed local Whisper recognizer. */
import z from '@deepseek-ai/schemastery'
import { availableParallelism } from 'node:os'
import { MAX_TIMER_DELAY_MS } from '@aeven/timeout'

/** Local runtime, inference, and retention settings. */
export interface Config {
  /** Unique registration id; consumers select this exact id. */
  providerId: string
  /** Absolute directory for verified models. */
  dataRoot: string
  /** Existing Whisper ggml model file; omission downloads the verified model. */
  modelPath?: string | undefined
  /** Existing Silero VAD ggml file; omission downloads the verified model. */
  vadModelPath?: string | undefined
  /** Existing worker executable; omission resolves the platform package's prebuilt worker. */
  workerPath?: string | undefined
  /** Explicit Hugging Face-compatible origin; bypasses automatic selection and public fallback. */
  modelOrigin?: string | undefined
  /** Hugging Face-compatible origins compared before downloading each missing asset. */
  modelOrigins: string[]
  /** Deadline for concurrent HEAD probes, including redirects to the actual asset. */
  modelProbeTimeoutMs: number
  /** CPU thread count for inference outside the GPU. */
  threads: number
  /** Silero speech probability threshold. */
  vadThreshold: number
  /** Minimum speech duration retained by VAD. */
  vadMinSpeechMs: number
  /** Silence separating two speech segments. */
  vadMinSilenceMs: number
  /** Padding kept before and after each speech segment. */
  vadSpeechPadMs: number
  /** Maximum decoded WAV bytes accepted per recording. */
  maxAudioBytes: number
  /** Deadline for runtime preparation and cold model loading. */
  prepareTimeoutMs: number
  /** Deadline for one inference after the worker is ready. */
  inferenceTimeoutMs: number
  /** Idle period before stopping the worker; zero keeps it warm. */
  idleTimeoutMs: number
  /** Maximum accepted running and waiting transcriptions. */
  maxPending: number
  /** Managed process termination grace period. */
  graceMs: number
  /** Maximum retained worker diagnostic bytes. */
  maxLogBytes: number
  /** Maximum bytes of one worker response line. */
  maxResponseBytes: number
  /** Minimum interval between intermediate download progress notifications. */
  progressIntervalMs: number
}

const ORIGIN = /^https?:\/\/[^/\s?#@]+\/?$/

/** Validate deployment-varying runtime choices at plugin activation. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('whisper-local'),
  dataRoot: z.string().min(1).required(),
  modelPath: z.union([z.string().min(1), z.const(undefined)]),
  vadModelPath: z.union([z.string().min(1), z.const(undefined)]),
  workerPath: z.union([z.string().min(1), z.const(undefined)]),
  modelOrigin: z.union([z.string().pattern(ORIGIN), z.const(undefined)]),
  modelOrigins: z.array(z.string().pattern(ORIGIN)).min(1).default(['https://huggingface.co', 'https://hf-mirror.com']),
  modelProbeTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3000),
  // Inference scales nearly linearly up to ~8 threads; leave one core for the host.
  threads: z.natural().min(1).max(256).default(Math.max(1, Math.min(8, availableParallelism() - 1))),
  vadThreshold: z.number().min(0).max(1).default(0.5),
  vadMinSpeechMs: z.natural().max(600_000).default(250),
  vadMinSilenceMs: z.natural().max(600_000).default(100),
  vadSpeechPadMs: z.natural().max(10_000).default(30),
  maxAudioBytes: z.natural().min(46).default(4 * 1024 * 1024),
  prepareTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(3_600_000),
  inferenceTimeoutMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(120_000),
  idleTimeoutMs: z.natural().max(MAX_TIMER_DELAY_MS).default(300_000),
  maxPending: z.natural().min(1).default(4),
  graceMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(1000),
  maxLogBytes: z.natural().min(1).default(64 * 1024),
  maxResponseBytes: z.natural().min(1).default(128 * 1024),
  progressIntervalMs: z.natural().min(1).max(MAX_TIMER_DELAY_MS).default(100),
})
