/**
 * The common-namespace dictionaries. zh is the source of truth for the key
 * set (Chinese-first repo convention); en and es are checked complete against
 * it — a missing or extra key in either is a compile error.
 */
export { zh } from './zh.ts'
export { en } from './en.ts'
export { es } from './es.ts'
export type { CommonKey } from './zh.ts'
