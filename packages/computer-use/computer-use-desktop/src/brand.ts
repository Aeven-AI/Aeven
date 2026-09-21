/** Computer-use adapter identities. @module @aeven/computer-use-desktop/brand */

import type { Branded } from '@aeven/brand'

/** Provider-owned name identifying a registered desktop adapter. */
export type DesktopAdapterName = Branded<'DesktopAdapterName'>

/**
 * Brand an adapter name without changing or validating it.
 * @param name - name chosen by the adapter implementation.
 * @returns the same name carrying its desktop-adapter brand.
 */
export function DesktopAdapterName(name: string): DesktopAdapterName {
  return name as DesktopAdapterName
}
