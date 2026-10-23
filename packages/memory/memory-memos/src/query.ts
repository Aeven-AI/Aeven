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

/** Separators that mark a second topic in an explicit search query. */
const CLAUSE_SEPARATOR = /\s*(?:[,;\n]|\band\b|\bplus\b|\bversus\b|\bvs\.?)\s*/iu

/** Shortest clause worth its own retrieval; one word is noise, not a topic. */
const MIN_CLAUSE_CHARS = 3

/** Most retrievals one explicit search may fan out to, so a long query stays inside its budget. */
export const MAX_QUERY_CLAUSES = 4

/**
 * Split an explicit search query into the topics it names.
 *
 * Retrieval embeds the query whole, so a query naming several unrelated things - "huwelijkse voorwaarden,
 * Testarossa, Code d'Azur, Michel van den Heuvel" - sits far from every document and returns nothing
 * usable, while each name on its own returns its fact immediately. An explicit search therefore runs one
 * retrieval per clause and merges the results. Prose stays whole: no clause survives the split unless it
 * carries at least two words, so an ordinary sentence yields one clause and one retrieval.
 *
 * @param query - the recall query as the caller wrote it.
 * @returns the topics to retrieve separately, or an empty list when the query is not multi-topic.
 */
export function queryClauses(query: string): string[] {
  const clauses: string[] = []
  const seen = new Set<string>()
  for (const part of query.split(CLAUSE_SEPARATOR)) {
    const clause = part.replace(/\s+/gu, ' ').trim()
    if (clause.length < MIN_CLAUSE_CHARS) continue
    if (clause.split(' ').length < 2 && query.split(CLAUSE_SEPARATOR).length > 1) {
      // A single word between separators is only a topic when it is not just a connective.
      if (clause.length < MIN_CLAUSE_CHARS + 4) continue
    }
    const key = clause.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    clauses.push(clause)
    if (clauses.length >= MAX_QUERY_CLAUSES) break
  }
  return clauses.length > 1 ? clauses : []
}

/** Boundaries between the sentences of one message: a sentence end followed by space, or a line break. */
const SENTENCE_BOUNDARY = /(?<=[.!?])\s+|\s*\n+\s*/u

/** Fewest words a sentence needs to be its own topic. */
const MIN_SENTENCE_WORDS = 3

/**
 * Split the person's current message into its sentences for turn-start recall.
 *
 * Turn-start retrieval embeds the conversation whole, and a message that opens on one subject and asks about another -
 * "I have Oracle's $300 trial credit. What would you advise? I like to have aeven with highly performant inference" -
 * sits closest to memories of its first subject, while each sentence alone sits closest to memories of its own.
 * Each sentence therefore gets its own retrieval beside the whole query.
 *
 * @param message - the person's current message.
 * @param max - most sentences returned.
 * @returns the message's distinct sentences of at least three words, or an empty list for a one-sentence message.
 */
export function messageSentences(message: string, max: number): string[] {
  const sentences: string[] = []
  const seen = new Set<string>()
  for (const part of message.split(SENTENCE_BOUNDARY)) {
    const sentence = part.replace(/\s+/gu, ' ').trim()
    if (sentence.split(' ').length < MIN_SENTENCE_WORDS) continue
    const key = sentence.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    sentences.push(sentence)
  }
  return sentences.length > 1 ? sentences.slice(0, max) : []
}
