/** The sidebar's Artifacts row: a link to the `/artifacts` start address, opened in place on a plain click. */
import { IconPencilSparklesAnimated } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type { SidebarNavOwnerProps } from '@aeven/client-ui-sidebar/client'
import type {} from './locales.ts'

/** What the row needs from the plugin. */
export interface ArtifactsRowInjected {
  /** The start address the row links to. */
  href: string
  /** Open the start address in place. */
  open: () => void
}

/**
 * Render the Artifacts row. A modified click is left to the browser, so opening the link in a new tab works.
 * @param props - the shell's row classes, the injected navigation and the translator.
 * @returns the row link.
 */
export function ArtifactsRow({ rowClassName, iconClassName, labelClassName, href, open, t }:
  SidebarNavOwnerProps & ArtifactsRowInjected & PropsLocale<'artifacts'>) {
  return (
    <a
      className={rowClassName}
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        open()
      }}
    >
      <IconPencilSparklesAnimated className={iconClassName} />
      <span className={labelClassName}>{t('title')}</span>
    </a>
  )
}
