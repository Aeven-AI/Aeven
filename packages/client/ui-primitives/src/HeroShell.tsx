/**
 * The New Session hero: the product's name over the reader's greeting. Shared
 * by every page that opens on that screen (the chat's blank Session, Imagine);
 * each caller mounts its own composer below it.
 */
import type { ReactNode } from 'react'
import { useHeroGreeting, type HeroTranslate } from './hero-greeting.ts'
import css from './HeroShell.module.css'

/** Hero chrome props. */
export interface HeroShellProps {
  /** The hero's copy seat, bound to the chat's `conversation` namespace. */
  t: HeroTranslate
  /** Overlay content after the stack (modals). */
  children?: ReactNode
}

/**
 * Render the hero chrome: the product's name and the reader's greeting, above
 * the composer the caller mounts outside this component.
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, children }: HeroShellProps) {
  const greeting = useHeroGreeting(t)
  return (
    <div className={css.root}>
      <div className={css.stack}>
        <div className={css.text} data-testid="hero-greeting">
          {/* Aeven's New Session screen: the product's name over the greeting,
              the two sharing one line box pair with no gap between them. */}
          <span className={css.wordmark}>{t('brand.localBuild')}</span>
          <span className={css.greeting}>{greeting}</span>
        </div>
      </div>
      {children}
    </div>
  )
}
