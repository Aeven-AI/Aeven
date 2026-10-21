/** Localized copy adapters for Cordis-free Markdown primitives. */

import type { MarkdownLabels } from '@aeven/client-ui-primitives'
import type { ChatViewSlotProps } from './contract/slots.ts'

/**
 * Build the complete Markdown chrome copy for one locale revision.
 * @param t - Chat locale seat.
 * @returns Labels for code fences, footnotes, images, videos, and the
 * reasoning block the engine draws for a step's thinking.
 */
export function markdownLabels(t: ChatViewSlotProps['t']): MarkdownLabels {
  return {
    code: { copyLabel: t('copy'), copiedLabel: t('copied') },
    message: { title: t('markdown.message'), copyLabel: t('markdown.copyMessage') },
    footnotes: t('markdown.footnotes'),
    image: {
      dialog: t('markdown.imagePreview'),
      close: t('markdown.closeImagePreview'),
      previous: t('markdown.imagePrevious'),
      next: t('markdown.imageNext'),
      download: t('markdown.imageDownload'),
      info: t('markdown.imageInfo'),
      infoType: t('markdown.imageInfoType'),
      infoSize: t('markdown.imageInfoSize'),
      infoName: t('markdown.imageInfoName'),
      unknown: t('markdown.imageInfoUnknown'),
      megabytes: value => t('markdown.imageMegabytes', { value }),
    },
    // `{title}` is left for the engine, which fills in the title the link gave.
    video: {
      play: t('markdown.playVideo', { title: '{title}' }),
      playUntitled: t('markdown.playVideoUntitled'),
    },
    // The engine replaces the placeholder itself, with a duration it measured,
    // so the template travels with its own `{seconds}` and neither language has
    // to guess where the figure goes in the sentence.
    reasoning: {
      thinking: t('message.think'),
      thoughtFor: t('message.thoughtFor', { seconds: '{seconds}' }),
    },
  }
}
