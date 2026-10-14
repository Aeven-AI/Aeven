/** Catalog cache JSON decoding. @module @aeven/subscription-auth/models-cache */

/**
 * Read the object envelope of a disposable models cache.
 * @param text - Stored JSON.
 * @returns The object, or undefined when corrupt or not an object.
 */
export function parseModelsCache(text: string): Record<string, unknown> | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    // Corrupt caches are replaced by the next catalog sync.
    return undefined
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}
