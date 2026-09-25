/** Imagine's address space: `/i/<uuid>`, one id per Imagine page. */

import { randomUUID } from '@aeven/util-crypto'

/** The path root the Imagine surface claims. */
export const IMAGINE_ROOT = '/i'

/** An Imagine id is a UUID, the same shape the chat's `/c/<uuid>` accepts. */
const IMAGINE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Read the Imagine id a path names.
 * @param pathname - the address bar's pathname.
 * @returns the lower-cased id for `/i/<uuid>`; undefined for `/i`, a nested
 * path, or an id that is not a UUID.
 */
export function imagineIdOf(pathname: string): string | undefined {
  if (!pathname.startsWith(`${IMAGINE_ROOT}/`)) return undefined
  const id = pathname.slice(IMAGINE_ROOT.length + 1)
  return IMAGINE_UUID.test(id) ? id.toLowerCase() : undefined
}

/**
 * Address for a new Imagine page.
 * @returns `/i/<uuid>` with a freshly minted id.
 */
export function newImaginePath(): string {
  return `${IMAGINE_ROOT}/${randomUUID()}`
}
