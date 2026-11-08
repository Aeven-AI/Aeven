/**
 * The in-app browser's history: every page a tab commits, across sessions, kept in
 * this window's storage for the agent's history search and the address bar's
 * suggestions. Nothing here is shown as its own surface.
 */

/** One visited page. */
export interface HistoryEntry {
  readonly url: string
  readonly title: string
  /** Last visit, in ms since the epoch. */
  readonly visitedAt: number
  /** How many times the address was committed. */
  readonly visits: number
}

/** Storage key for the history list. */
const STORAGE_KEY = 'avn.sidebar-right.browser.history'
/** Addresses kept, newest first; older ones are dropped. */
const MAX_ENTRIES = 2000

/**
 * Read the stored history.
 * @returns entries newest first, or none when storage is unavailable or holds something else.
 */
function read(): HistoryEntry[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter((entry): entry is HistoryEntry => typeof entry === 'object' && entry !== null
        && typeof (entry as HistoryEntry).url === 'string' && typeof (entry as HistoryEntry).title === 'string'
        && typeof (entry as HistoryEntry).visitedAt === 'number' && typeof (entry as HistoryEntry).visits === 'number')
      : []
  } catch {
    // Unreadable or unavailable storage starts an empty history.
    return []
  }
}

/**
 * Write the history.
 * @param entries - entries newest first.
 */
function write(entries: readonly HistoryEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)))
  } catch {
    // Unavailable storage keeps no history; browsing is unaffected.
  }
}

/**
 * Record a committed page, moving its address to the front.
 * @param url - the committed address; blank and non-web addresses are not recorded.
 * @param title - the page title, possibly empty until the page reports one.
 */
export function recordVisit(url: string, title: string): void {
  if (!/^https?:/i.test(url)) return
  const entries = read()
  const previous = entries.find(entry => entry.url === url)
  write([
    { url, title: title === '' ? previous?.title ?? '' : title, visitedAt: Date.now(), visits: (previous?.visits ?? 0) + 1 },
    ...entries.filter(entry => entry.url !== url),
  ])
}

/**
 * Update the title of a recorded page when it reports one after committing.
 * @param url - the page's address.
 * @param title - its title.
 */
export function recordTitle(url: string, title: string): void {
  if (title === '') return
  const entries = read()
  const index = entries.findIndex(entry => entry.url === url)
  const entry = entries[index]
  if (entry === undefined || entry.title === title) return
  entries[index] = { ...entry, title }
  write(entries)
}

/**
 * Search the history: every word of the query must appear in the address or title.
 * @param query - words to match, case-insensitively; empty returns the newest entries.
 * @param limit - most entries returned.
 * @returns matches, newest first.
 */
export function searchHistory(query: string, limit: number): HistoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(word => word !== '')
  return read()
    .filter(entry => words.every(word => entry.url.toLowerCase().includes(word) || entry.title.toLowerCase().includes(word)))
    .slice(0, limit)
}

/** Forget the whole history. */
export function clearHistory(): void {
  write([])
}
