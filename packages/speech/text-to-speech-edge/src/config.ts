/** Composition contract for the Edge read-aloud provider. */
import z from '@deepseek-ai/schemastery'

/** One voice the deployment offers, named by its service voice id. */
export interface VoiceConfig {
  /** Service voice id, such as `en-US-AvaMultilingualNeural`. */
  id: string
  /** Display name shown in Surfaces. */
  name: string
  /** Primary language subtag the voice speaks. */
  language: string
  /** Timbre, so a configured row keeps it when the provider's own listing is replaced. */
  gender?: 'female' | 'male'
}

/** Validated runtime configuration for the provider plugin. */
export interface Config {
  /** Provider id registered in the synthesis registry. */
  providerId: string
  /** Voices this deployment exposes; the language mapping references these ids. */
  voices: VoiceConfig[]
  /** Locales whose Edge voices join the catalogue at startup, such as `nl-NL`; an empty list takes every locale. */
  locales: string[]
  /** Per-request synthesis deadline in milliseconds. */
  timeoutMs: number
}

/** Schema for the provider plugin configuration. */
export const Config: z<Partial<Config>, Config> = z.object({
  providerId: z.string().min(1).default('edge'),
  voices: z.array(z.object({
    id: z.string().min(1).required(),
    name: z.string().min(1).required(),
    language: z.string().min(1).required(),
    gender: z.union(['female', 'male'] as const),
  })).required(),
  locales: z.array(z.string().min(2)).default([]),
  timeoutMs: z.natural().min(1000).default(20000),
})
