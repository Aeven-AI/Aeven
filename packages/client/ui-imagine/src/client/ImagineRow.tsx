/** The sidebar's Imagine row: a link to the `/imagine` start address, opened in place on a plain click. */
import type { MouseEvent as ReactMouseEvent } from 'react'
import { IconLucideImages } from '@aeven/client-ui-primitives'
import type { PropsLocale } from '@aeven/client-ui-slots'
import type { SidebarNavOwnerProps } from '@aeven/client-ui-sidebar/client'
import type {} from './locales.ts'

/** What the row needs from the plugin. */
export interface ImagineRowInjected {
  /** The start address the row links to. */
  href: string
  /** Open the start address in place. */
  open: () => void
}

/**
 * Whether a click is a plain primary activation the page handles in place; a modified click is left to the
 * browser, so opening the link in a new tab still works.
 */
function isPlainClick(event: ReactMouseEvent): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey
}

/**
 * Render the Imagine row.
 * @param props - the shell's row classes, the injected navigation and the translator.
 * @returns the row link.
 */
export function ImagineRow({ rowClassName, iconClassName, labelClassName, href, open, t }:
  SidebarNavOwnerProps & ImagineRowInjected & PropsLocale<'imagine'>) {
  return (
    <a
      className={rowClassName}
      href={href}
      onClick={(event) => {
        if (!isPlainClick(event)) return
        event.preventDefault()
        open()
      }}
    >
      <IconLucideImages className={iconClassName} />
      <span className={labelClassName}>{t('title')}</span>
    </a>
  )
}
