/**
 * The operation kinds a GraphQL document defines.
 *
 * The read tool must never run a mutation, so the classifier reads every top-level definition
 * of the document rather than its first word: strings, block strings, and comments are skipped,
 * and each definition at brace depth zero is named by its keyword (`query`, `mutation`,
 * `subscription`, `fragment`) or is a shorthand query (`{ … }`).
 */

/** Kind of one top-level definition in a GraphQL document. */
export type DefinitionKind = 'query' | 'mutation' | 'subscription' | 'fragment'

const KEYWORDS: ReadonlySet<string> = new Set(['query', 'mutation', 'subscription', 'fragment'])

/**
 * The definition kinds of a document, keyword-introduced and shorthand alike, in document order.
 * @param document - a GraphQL document.
 * @returns the kinds, or undefined for a document this reading cannot accept: an unterminated
 * string, unbalanced braces, a keyword without a selection set, or a definition that starts
 * with any other word.
 */
export function classify(document: string): DefinitionKind[] | undefined {
  const kinds: DefinitionKind[] = []
  let depth = 0
  let index = 0
  let pending: DefinitionKind | undefined
  while (index < document.length) {
    const char = document[index] ?? ''
    if (char === '#') {
      const end = document.indexOf('\n', index)
      index = end === -1 ? document.length : end + 1
    } else if (document.startsWith('"""', index)) {
      let end = index + 3
      for (;;) {
        end = document.indexOf('"""', end)
        if (end === -1) return undefined
        if (document[end - 1] !== '\\') break
        end += 3
      }
      index = end + 3
    } else if (char === '"') {
      let end = index + 1
      while (end < document.length && document[end] !== '"' && document[end] !== '\n') end += document[end] === '\\' ? 2 : 1
      if (document[end] !== '"') return undefined
      index = end + 1
    } else if (char === '{') {
      if (depth === 0) {
        kinds.push(pending ?? 'query')
        pending = undefined
      }
      depth += 1
      index += 1
    } else if (char === '}') {
      depth -= 1
      if (depth < 0) return undefined
      index += 1
    } else if (depth === 0 && /[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(document.slice(index))?.[0] ?? ''
      if (pending === undefined) {
        if (!KEYWORDS.has(word)) return undefined
        pending = word as DefinitionKind
      }
      // Later words before the selection set are the name, `on Type`, variable types, or directive names.
      index += word.length
    } else {
      index += 1
    }
  }
  if (depth !== 0 || pending !== undefined) return undefined
  return kinds
}

/**
 * Whether a document only reads: it defines at least one query and no mutation or subscription.
 * @param document - a GraphQL document.
 * @returns true when every operation is a query.
 */
export function isReadDocument(document: string): boolean {
  const kinds = classify(document)
  return kinds !== undefined && kinds.includes('query') && kinds.every(kind => kind === 'query' || kind === 'fragment')
}

/**
 * Whether a document defines exactly one operation and it is a mutation.
 * @param document - a GraphQL document.
 * @returns true for a single-mutation document, fragments allowed.
 */
export function isMutationDocument(document: string): boolean {
  const kinds = classify(document)
  return kinds !== undefined && kinds.filter(kind => kind !== 'fragment').length === 1 && kinds.includes('mutation')
}
