/**
 * The document classifier the read tool relies on to never run a mutation.
 */

import { describe, expect, it } from 'vitest'
import { classify, isMutationDocument, isReadDocument } from '../aeven/graphql.ts'

describe('GraphQL document classifier', () => {
  it('names every top-level definition, keyword and shorthand alike', () => {
    expect(classify('{ shop { name } }')).toEqual(['query'])
    expect(classify('query Products($first: Int = 10) @cached { products(first: $first) { nodes { id } } }')).toEqual(['query'])
    expect(classify('fragment F on Product { id } query { products(first: 1) { nodes { ...F } } }')).toEqual(['fragment', 'query'])
    expect(classify('mutation Update($input: ProductInput!) { productUpdate(input: $input) { userErrors { message } } }')).toEqual(['mutation'])
  })

  it('finds a mutation hidden after a query', () => {
    const document = 'query A { shop { name } }\nmutation B { productDelete(input: { id: "gid://shopify/Product/1" }) { deletedProductId } }'
    expect(isReadDocument(document)).toBe(false)
    expect(isMutationDocument(document)).toBe(false)
  })

  it('is not fooled by the word mutation inside strings, block strings, or comments', () => {
    expect(isReadDocument('query { products(query: "mutation } {") { nodes { id } } }')).toBe(true)
    expect(isReadDocument('query {\n  # mutation { productDelete }\n  shop { name }\n}')).toBe(true)
    expect(isReadDocument('query { products(query: """ mutation { x } """) { nodes { id } } }')).toBe(true)
  })

  it('refuses documents it cannot read', () => {
    for (const document of ['', 'query', 'query { shop { name }', 'shop { name }', 'query { a(b: "open) }', '} {', 'subscription { x }']) {
      expect(isReadDocument(document), document).toBe(false)
    }
  })

  it('accepts exactly one mutation, with fragments', () => {
    expect(isMutationDocument('fragment E on UserError { message } mutation { productCreate(product: { title: "Mug" }) { userErrors { ...E } } }')).toBe(true)
    expect(isMutationDocument('mutation A { a } mutation B { b }')).toBe(false)
    expect(isMutationDocument('query { shop { name } }')).toBe(false)
  })
})
