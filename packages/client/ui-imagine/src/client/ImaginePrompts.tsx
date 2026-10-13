/**
 * Imagine's start page: a grid of starter prompts with example images, shown in place of a blank chat's Hero
 * while the address is `/imagine`. Choosing one opens its popup, which previews what the prompt makes and what it
 * asks the model for; `Try it` there puts the message in the composer, where it can be edited and sent like any
 * message.
 */
import { useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import { IMAGINE_PROMPTS, promptImageUrl } from './prompts.ts'
import type { ImaginePromptId } from './prompts.ts'
import { PromptDialog } from './PromptDialog.tsx'
import type {} from './locales.ts'
import css from './ImaginePrompts.module.css'

/**
 * Render the starter prompts.
 * @param props - the Session's input actions and the translator.
 * @returns the prompt grid and, while one is open, its popup.
 */
export function ImaginePrompts({ inputActions, t }: PropsRuntime<'conversation.start'> & PropsLocale<'imagine'>) {
  const [open, setOpen] = useState<ImaginePromptId | null>(null)
  // An example image that has not shipped yet leaves its card title-only
  // rather than showing a broken frame.
  const [missing, setMissing] = useState<readonly ImaginePromptId[]>([])
  const opened = IMAGINE_PROMPTS.find(prompt => prompt.id === open)
  return (
    <section className={css.root} aria-label={t('prompts.label')}>
      <div className={css.grid}>
        {IMAGINE_PROMPTS.map(({ id, image }) => (
          <button
            key={id}
            type="button"
            className={css.card}
            data-prompt={id}
            onClick={() => { setOpen(id) }}
          >
            {image !== undefined && !missing.includes(id) && (
              <img
                className={css.image}
                src={promptImageUrl(image)}
                alt=""
                loading="lazy"
                onError={() => { setMissing(current => current.includes(id) ? current : [...current, id]) }}
              />
            )}
            <span className={css.shade} aria-hidden="true" />
            <span className={css.title}>{t(`prompt.${id}.title`)}</span>
          </button>
        ))}
      </div>
      {opened !== undefined && (
        <PromptDialog
          key={opened.id}
          prompt={opened}
          inputActions={inputActions}
          t={t}
          onClose={() => { setOpen(null) }}
        />
      )}
    </section>
  )
}
