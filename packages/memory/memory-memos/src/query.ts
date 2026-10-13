/**
 * Query text hygiene for MemOS retrieval.
 *
 * The core reads a long identifier in a query as a hard eligibility filter: it keeps only candidates
 * that contain that identifier verbatim. That is correct for an identifier lookup and wrong for a
 * turn-start topic query, where a pasted session id, commit hash, or version drops every candidate
 * and the turn runs with no memory at all. These predicates mirror the core's own rule so a retry can
 * drop exactly those tokens and leave ordinary long words (`configuration`) untouched.
 *
 * @module @aeven/memory-memos/query
 */

/** Token text the core considers for identifier confirmation, with the same character set it matches. */
const IDENTIFIER_TOKEN = /[A-Za-z0-9_:-]{12,}/gu

/** Longest token the core confirms exactly. */
const MAX_IDENTIFIER_CHARS = 128

/** Shortest token the core requires before it demands an exact match. */
const MIN_IDENTIFIER_CHARS = 16

/**
 * Whether the core would require a candidate to contain this token verbatim.
 * @param token - one token matched by the core's identifier pattern.
 * @returns true when the core treats the token as an exact identifier.
 */
export function isExactIdentifier(token: string): boolean {
  const normalized = token.normalize('NFKC').toLowerCase().trim()
  if (normalized.length > MAX_IDENTIFIER_CHARS) return false
  const hasIdentifierShape = /[_:-]/u.test(normalized) || /\d/u.test(normalized)
  const hasEnoughEntropy = /[a-z]/u.test(normalized) && normalized.length >= MIN_IDENTIFIER_CHARS
  return hasIdentifierShape && hasEnoughEntropy
}

/**
 * Remove every token the core would confirm exactly, collapsing the whitespace left behind.
 * @param query - the recall query as the caller wrote it.
 * @returns the same query with identifier tokens dropped; equal to `query` when it holds none.
 */
export function withoutExactIdentifiers(query: string): string {
  return query
    .replace(IDENTIFIER_TOKEN, token => (isExactIdentifier(token) ? ' ' : token))
    .replace(/\s+/gu, ' ')
    .trim()
}
