/**
 * Read-through cache for a plugin's own remote reads: the last accepted answer
 * per key, so a surface that remounts paints that answer immediately and
 * revalidates behind the paint instead of showing its loading state again.
 *
 * The keys are the calling plugin's, because only it knows which reads answer
 * the same question and which writes invalidate them.
 */

/** A plugin-owned read cache: last accepted value per key, one read in flight per key. */
export interface ReadCache {
  /**
   * The last accepted value for a key.
   * @param key - caller-owned cache key.
   * @returns that value, or undefined when no read of the key has settled.
   */
  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- a reading plugin asserts the stored type for a key it owns
  peek<T>(key: string): T | undefined
  /**
   * Read a key through the cache. Callers that arrive while the key's read is
   * in flight share that one read; a settled value replaces the stored one; a
   * failure rejects every caller waiting on it and leaves the stored value
   * untouched, so a surface that already painted keeps painting it.
   * @param key - caller-owned cache key.
   * @param load - the read to perform when this key has no read in flight.
   * @returns the read's value, or its rejection.
   */
  read<T>(key: string, load: () => Promise<T>): Promise<T>
  /**
   * Drop stored keys and forget queued reads for them, so the next read of each
   * key is a real read. A read already in flight when its key is dropped still
   * answers its callers, but no longer stores what it returns.
   * @param match - selects the keys to drop; omitted drops every key.
   */
  invalidate(match?: (key: string) => boolean): void
}

/**
 * Create a read cache.
 * @returns the cache, owned by the plugin that reads through it.
 */
export function createReadCache(): ReadCache {
  const values = new Map<string, unknown>()
  const inflight = new Map<string, Promise<unknown>>()
  return {
    // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- the interface's assertion, kept in the implementation
    peek<T>(key: string): T | undefined {
      return values.get(key) as T | undefined
    },
    read<T>(key: string, load: () => Promise<T>): Promise<T> {
      const running = inflight.get(key)
      if (running !== undefined) return running as Promise<T>
      const pending = load().then(
        (value) => {
          if (inflight.get(key) === pending) {
            inflight.delete(key)
            values.set(key, value)
          }
          return value
        },
        (error: unknown) => {
          if (inflight.get(key) === pending) inflight.delete(key)
          throw error
        },
      )
      inflight.set(key, pending)
      return pending
    },
    invalidate(match?: (key: string) => boolean): void {
      const dropped = (key: string): boolean => match === undefined || match(key)
      for (const key of [...values.keys()]) if (dropped(key)) values.delete(key)
      for (const key of [...inflight.keys()]) if (dropped(key)) inflight.delete(key)
    },
  }
}
