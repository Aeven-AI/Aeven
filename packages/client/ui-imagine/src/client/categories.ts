/**
 * The Inspiration page's categories, in pill order, and the start address each one lives at.
 * `Image & video` is the bare `/inspiration`; every other category is a path beneath it, so each
 * pill is a link of its own (`/inspiration/slides`).
 */

/** The categories in pill order. */
export const CATEGORIES = ['image-video', 'slides', 'letters', 'websites', 'apps'] as const

/** One Inspiration category. */
export type Category = typeof CATEGORIES[number]

/** Each category's start address. */
export const CATEGORY_PATHS = {
  'image-video': '/inspiration',
  slides: '/inspiration/slides',
  letters: '/inspiration/letters',
  websites: '/inspiration/websites',
  apps: '/inspiration/apps',
} as const satisfies Record<Category, string>

/** What the page receives from the plugin for the address it is shown at. */
export interface InspirationInjected {
  /** The category this address shows. */
  category: Category
  /** Open another category's address in place. */
  showCategory: (category: Category) => void
}
