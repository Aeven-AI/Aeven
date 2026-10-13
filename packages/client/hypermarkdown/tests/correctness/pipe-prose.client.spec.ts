import { describe, expect, it } from 'vitest'

import { parseMarkup, renderStatic, renderStreamed } from '../helpers/render.client.ts'

/**
 * A pipe is not a table. GFM needs a delimiter row before a run of pipe lines
 * is a table, and model output carries pipes everywhere else: shell pipelines
 * in a bullet list, a regex alternation such as `(?:I|we)`, a TypeScript union,
 * a `||` inside a code snippet. The engine used to rebuild any two consecutive
 * pipe-carrying lines as a table with a synthetic header, which put a table
 * into reasoning and answers where nobody wrote one.
 */
const prose = {
  'bullets carrying shell pipelines':
    '- `ls -R ~/.aeven/storages | head -50`\n- `grep -rn "stateVersion" packages/session/*/src | head`\n\n',
  'bullets carrying a regex alternation':
    '- `\\b(?:I|we)\\s+` — needs "I" followed by whitespace.\n- Other branches: `\\b(?:tests?|checks?)\\s+passed\\b` no.\n\n',
  'code lines carrying a logical or':
    '})).filter(a => a.text || a.host);\nconst external = b || c;\n\n',
  'one sentence carrying two pipes':
    'The domain is `person | project | world`, and the tag is `x | y`.\n\n',
  'a union type in a comment':
    "Or keep `oauthReturn?: 'redirect' | 'window'`.\nThe flow is 'redirect' | 'popup' | 'window'.\n\n",
}

/** A real table: every line opens with its own pipe. */
const tables = {
  'headless rows': '| a | b |\n| c | d |\n\n',
  'headless rows, widening': '| a | b |\n| c | d | e |\n\n',
  'rows with a delimiter': '| a | b |\n| --- | --- |\n| c | d |\n\n',
  'rows indented under a list item':
    '- item\n\n  | a | b |\n  | c | d |\n\n',
  'quoted rows': '> | a | b |\n> | c | d |\n\n',
}

/** Every chunk size that a delta can arrive in, including the whole document. */
const CHUNKS = [1, 3, 200]

describe('pipe-carrying prose', () => {
  it.each(Object.entries(prose))('renders %s as prose', (_name, md) => {
    for (const markup of [renderStatic(md), ...CHUNKS.map(size => renderStreamed(md, size))]) {
      const body = parseMarkup(markup).body

      expect(body.querySelector('table')).toBe(null)
      // Not just missing the table element: none of the synthetic rows the
      // repair writes may be left behind as literal text either.
      expect(body.textContent).not.toContain(':---')
    }
  })

  it.each(Object.entries(tables))('still renders %s as a table', (_name, md) => {
    for (const markup of [renderStatic(md), ...CHUNKS.map(size => renderStreamed(md, size))]) {
      expect(parseMarkup(markup).body.querySelector('table')).not.toBe(null)
    }
  })

  it('keeps the prose after a table out of the table', () => {
    const md = '| a | b |\n| c | d |\n\nSome prose about x | y here.\n\nMore prose.\n\n'

    for (const markup of [renderStatic(md), ...CHUNKS.map(size => renderStreamed(md, size))]) {
      const body = parseMarkup(markup).body
      const cells = Array.from(body.querySelectorAll('td')).map(cell => cell.textContent)

      expect(cells).toEqual(['a', 'b', 'c', 'd'])
      expect(body.textContent).toContain('Some prose about x | y here.')
    }
  })
})
