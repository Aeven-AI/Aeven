/**
 * Recipe routing for computer use: which layer performs a task, on which
 * platform, in which application — and what must be independently true after.
 *
 * @module @aeven/computer-use-router
 */

export * from './recipe.ts'
export * from './router.ts'
export { STARTER_BOOK } from './book.ts'
export * from './capabilities.ts'
export {
  CALCULATOR_RECIPES,
  CALENDAR_EVENT_RECIPES,
  CLOCK_RECIPES,
  COMMON_APP_RECIPES,
  NOTES_RECIPES,
  PAGES_TEMPLATE_RECIPES,
} from './common.ts'
export {
  DOCUMENT_RECIPES,
  OFFICE_RECIPES,
  PRESENTATION_RECIPES,
  SPREADSHEET_RECIPES,
} from './office.ts'
