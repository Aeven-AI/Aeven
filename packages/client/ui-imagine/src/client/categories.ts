/**
 * The Inspiration page's categories, in pill order, and the start address each one lives at.
 * `Image & video` is the bare `/inspiration`, `Slides` is `/inspiration/slides` and `Resumes` is
 * `/inspiration/resumes`, so each pill is a link of its own. Each card's popup has an address of its own
 * one segment below its category, such as `/inspiration/slides/dark-pills`, so a card is a link too.
 */
import type { HostObservable } from '@aeven/client-ui-slots'

/** The categories in pill order. */
export const CATEGORIES = ['image-video', 'slides', 'resumes'] as const

/** One Inspiration category. */
export type Category = typeof CATEGORIES[number]

/** Each category's start address. */
export const CATEGORY_PATHS = {
  'image-video': '/inspiration',
  slides: '/inspiration/slides',
  resumes: '/inspiration/resumes',
} as const satisfies Record<Category, string>

/** Each category's card addresses, as the start-address pattern that claims them. */
export const CARD_PATTERNS = {
  'image-video': '/inspiration/:key',
  slides: '/inspiration/slides/:key',
  resumes: '/inspiration/resumes/:key',
} as const satisfies Record<Category, string>

/**
 * The address of one card's popup.
 * @param category - the card's category.
 * @param id - the prompt's or template's id.
 * @returns the address one segment below the category's.
 */
export function cardPath(category: Category, id: string): string {
  return `${CATEGORY_PATHS[category]}/${id}`
}

/**
 * The card an address opens within a category.
 * @param category - the category the page shows.
 * @param address - the current start address.
 * @returns the card id the address names, or undefined at the category's own address.
 */
export function openedCard(category: Category, address: string | undefined): string | undefined {
  const prefix = `${CATEGORY_PATHS[category]}/`
  if (address === undefined || !address.startsWith(prefix)) return undefined
  const id = address.slice(prefix.length)
  return id === '' || id.includes('/') ? undefined : id
}

/** What the page receives from the plugin for the address it is shown at. */
export interface InspirationInjected {
  /** The category this address shows. */
  category: Category
  /** Open another category's address in place. */
  showCategory: (category: Category) => void
  /** Open a card's popup at its own address. */
  openCard: (path: string) => void
  hooks: {
    /** The current start address, which names the open card. */
    address: HostObservable<string | undefined>
  }
}
