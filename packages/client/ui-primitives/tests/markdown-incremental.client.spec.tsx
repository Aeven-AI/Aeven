// @vitest-environment jsdom
// Streaming reconciliation for MarkdownText: the engine takes deltas through a
// mutable store while this component takes accumulated source text. These pin
// that a streamed reply and a settled one land on the same DOM, that mounting
// partway through a reply catches up, and that the writes stay idempotent
// under the re-renders React is free to perform.

import { StrictMode } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(cleanup)

/** Documents whose streamed shape is cached per line or per row by the engine. */
const DOCS = {
  prose: '# Title\n\nFirst para with **bold**.\n\nSecond para is long enough.',
  fence: 'Intro.\n\n```ts\nconst a: number = 1\n// c\nfunction f() { return a }\n```\n\nAfter.',
  table: 'Head\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nTail.',
  list: 'Items:\n\n- one\n- two with **bold**\n- three\n  - nested\n\nDone.',
  mixed: '## H\n\n- a\n- b\n\n```js\nlet x = 1\n```\n\n| p | q |\n| --- | --- |\n| 1 | 2 |\n\n> quote\n\nEnd.',
}

describe('MarkdownText streaming reconciliation', () => {
  for (const [name, doc] of Object.entries(DOCS)) {
    it(`${name}: a streamed reply settles into the settled render`, () => {
      const live = render(<MarkdownText text="" streaming />)
      for (let cut = 8; cut < doc.length; cut += 8) {
        live.rerender(<MarkdownText text={doc.slice(0, cut)} streaming />)
      }
      live.rerender(<MarkdownText text={doc} streaming />)
      live.rerender(<MarkdownText text={doc} />)
      const settled = render(<MarkdownText text={doc} />)
      expect(live.container.innerHTML).toBe(settled.container.innerHTML)
    })

    it(`${name}: mounting partway through a reply catches up`, () => {
      const settled = render(<MarkdownText text={doc} />)
      const expected = settled.container.innerHTML
      for (let cut = 0; cut <= doc.length; cut += 5) {
        const live = render(<MarkdownText text={doc.slice(0, cut)} streaming />)
        live.rerender(<MarkdownText text={doc} streaming />)
        live.rerender(<MarkdownText text={doc} />)
        expect(live.container.innerHTML, `mounted at ${cut}`).toBe(expected)
        live.unmount()
      }
    })
  }

  it('re-rendering an unchanged streaming text writes nothing further', () => {
    const partial = DOCS.prose.slice(0, 20)
    const live = render(<MarkdownText text={partial} streaming />)
    const once = live.container.innerHTML
    for (let repeat = 0; repeat < 5; repeat++) {
      live.rerender(<MarkdownText text={partial} streaming />)
    }
    expect(live.container.innerHTML).toBe(once)
  })

  it('re-rendering an unchanged settled text writes nothing further', () => {
    const live = render(<MarkdownText text={DOCS.prose} />)
    const once = live.container.innerHTML
    for (let repeat = 0; repeat < 3; repeat++) {
      live.rerender(<MarkdownText text={DOCS.prose} />)
    }
    expect(live.container.innerHTML).toBe(once)

    // A settled view swapped to a different settled source re-parses it.
    live.rerender(<MarkdownText text={DOCS.list} />)
    const other = render(<MarkdownText text={DOCS.list} />)
    expect(live.container.innerHTML).toBe(other.container.innerHTML)
  })

  it('a rewritten source reseeds instead of appending to the old one', () => {
    const live = render(<MarkdownText text={'alpha\n\nbeta'} streaming />)
    live.rerender(<MarkdownText text="a different reply" streaming />)
    live.rerender(<MarkdownText text="a different reply" />)
    const fresh = render(<MarkdownText text="a different reply" />)
    expect(live.container.innerHTML).toBe(fresh.container.innerHTML)
  })

  it('a settled mount under StrictMode writes once, not twice', () => {
    // StrictMode invokes the mount effect twice. The second pass sees its own
    // write already recorded and must skip it rather than re-parse.
    const strict = render(<StrictMode><MarkdownText text={DOCS.table} /></StrictMode>)
    const plain = render(<MarkdownText text={DOCS.table} />)
    expect(strict.container.innerHTML).toBe(plain.container.innerHTML)
  })

  it('survives StrictMode double invocation while streaming', () => {
    const doc = DOCS.mixed
    const strict = render(
      <StrictMode><MarkdownText text={doc.slice(0, 30)} streaming /></StrictMode>,
    )
    strict.rerender(<StrictMode><MarkdownText text={doc} streaming /></StrictMode>)
    strict.rerender(<StrictMode><MarkdownText text={doc} /></StrictMode>)
    const plain = render(<MarkdownText text={doc} />)
    expect(strict.container.innerHTML).toBe(plain.container.innerHTML)
  })
})
