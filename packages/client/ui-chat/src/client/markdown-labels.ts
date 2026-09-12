/** Localized copy adapters for Cordis-free Markdown primitives. */

import type { MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from './contract/slots.ts'

/**
 * Build the complete Markdown chrome copy for one locale revision.
 * @param t - Chat locale seat.
 * @returns Labels for code fences, footnotes, and the reasoning block the
 * engine draws for a step's thinking.
 */
export function markdownLabels(t: ChatViewSlotProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    footnotes: t('markdown.footnotes'),
    // The engine replaces the placeholder itself, with a duration it measured,
    // so the template travels with its own `{seconds}` and neither language has
    // to guess where the figure goes in the sentence.
    reasoning: {
      thinking: t('message.think'),
      thoughtFor: t('message.thoughtFor', { seconds: '{seconds}' }),
    },
  }
}
