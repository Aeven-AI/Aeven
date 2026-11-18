/**
 * The account's recall preference as Settings → General reads and writes it. `@aeven/memory-memos` registers the
 * section and reads it on every turn-start recall; the names here are the ones it registers.
 */

/** Settings namespace of each account's recall preferences. */
export const MEMORY_RECALL_SETTINGS_NAMESPACE = 'memory-recall'

/** Field holding whether a relevance judgment selects the recalled memories. */
export const MEMORY_RECALL_JUDGE_FIELD = 'judge'

/** One account's recall preferences. */
export interface MemoryRecallSettings {
  /** Whether one more model call before each answer picks which recalled memories the turn receives. */
  judge: boolean
}
