/**
 * Imagine's start page: a grid of starter prompts with example images, shown in place of a blank chat's Hero
 * while the address is `/imagine`. Choosing one puts its prompt in the composer, where it can be edited and sent
 * like any message.
 */
import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-conversation/client'
import { IMAGINE_PROMPTS, promptImageUrl } from './prompts.ts'
import type {} from './locales.ts'
import css from './ImaginePrompts.module.css'

/**
 * Render the starter prompts.
 * @param props - the Session's input actions and the translator.
 * @returns the prompt grid.
 */
export function ImaginePrompts({ inputActions, t }: PropsRuntime<'conversation.start'> & PropsLocale<'imagine'>) {
  return (
    <section className={css.root} aria-label={t('prompts.label')}>
      <div className={css.grid}>
        {IMAGINE_PROMPTS.map(({ id, image }) => (
          <button
            key={id}
            type="button"
            className={css.card}
            onClick={() => { inputActions.setDraft(t(`prompt.${id}.text`)) }}
          >
            {image !== undefined && <img className={css.image} src={promptImageUrl(image)} alt="" loading="lazy" />}
            <span className={css.shade} aria-hidden="true" />
            <span className={css.title}>{t(`prompt.${id}.title`)}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
