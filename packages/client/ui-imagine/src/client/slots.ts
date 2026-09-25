/**
 * The Imagine page's props. The target `surface` slot is declared and typed by
 * ui-layout; this package only contributes the `imagine` entry, so no SlotMap
 * merge lives here.
 * @module @aeven/client-ui-imagine/client/slots
 */

import type { PropsLocale, PropsRuntime } from '@aeven/client-ui-slots'
import type {} from '@aeven/client-ui-layout/client'
import type { HeroTranslate } from '@aeven/client-ui-primitives'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'imagine' seat).
import type {} from './locales.ts'

/** Injected share of the Imagine page. */
export interface ImaginePageInjected {
  /** The chat's copy, read by the shared hero (product name and greeting). */
  heroT: HeroTranslate
}

/** Full props of the Imagine page. */
export type ImaginePageProps = PropsRuntime<'surface'> & PropsLocale<'imagine'> & ImaginePageInjected
