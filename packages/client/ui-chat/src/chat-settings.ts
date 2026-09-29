/** Chat transcript preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Transcript presentation modes accepted at settings boundaries. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'extended'] as const

/** Completed-Turn transcript presentation. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Default folds a completed Turn's process and omits its timing and usage chrome. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'normal'

/** Field carrying the word fade-in preference for streamed text. */
export const TEXT_ANIMATION_FIELD = 'textAnimation'

/** Default fades streamed words in, matching the Markdown engine's own default. */
export const DEFAULT_TEXT_ANIMATION = true

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content and per-Turn statistics. */
  transcriptView: TranscriptViewMode
  /** Whether streamed reply text and reasoning summaries fade in word by word. */
  textAnimation: boolean
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
  [TEXT_ANIMATION_FIELD]: z.boolean().default(DEFAULT_TEXT_ANIMATION),
})
