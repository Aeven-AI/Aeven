/**
 * The Inspiration page's categories, in pill order, and the start address each one lives at.
 * `Image & video` is the bare `/inspiration`, `Slides` is `/inspiration/slides` and `Resumes` is
 * `/inspiration/resumes`, so each pill is a link of its own.
 */

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

/** What the page receives from the plugin for the address it is shown at. */
export interface InspirationInjected {
  /** The category this address shows. */
  category: Category
  /** Open another category's address in place. */
  showCategory: (category: Category) => void
}
