// @vitest-environment jsdom
// Streaming reconciliation for MarkdownText: the engine takes deltas through a
// mutable store while this component takes accumulated source text. These pin
// that finalization remains on the engine's streaming lifecycle, that mounting
// partway through a reply catches up, and that writes stay idempotent under the
// re-renders React is free to perform.

import { StrictMode } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(cleanup)

/** Documents whose streamed representation is cached per line or row. */
const DOCS = {
  prose: {
    source: '# Title\n\nFirst para with **bold**.\n\nSecond para is long enough.',
    tail: 'long enough.',
  },
  fence: {
    source: 'Intro.\n\n```ts\nconst a: number = 1\n// c\nfunction f() { return a }\n```\n\nAfter.',
    tail: 'After.',
  },
  table: {
    source: 'Head\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\nTail.',
    tail: 'Tail.',
  },
  list: {
    source: 'Items:\n\n- one\n- two with **bold**\n- three\n  - nested\n\nDone.',
    tail: 'Done.',
  },
  mixed: {
    source: '## H\n\n- a\n- b\n\n```js\nlet x = 1\n```\n\n| p | q |\n| --- | --- |\n| 1 | 2 |\n\n> quote\n\nEnd.',
    tail: 'End.',
  },
}

describe('MarkdownText streaming reconciliation', () => {
  for (const [name, { source, tail }] of Object.entries(DOCS)) {
    it(`${name}: a streamed reply finalizes in the streaming renderer`, () => {
      const live = render(<MarkdownText text="" streaming />)
      for (let cut = 8; cut < source.length; cut += 8) {
        live.rerender(<MarkdownText text={source.slice(0, cut)} streaming />)
      }
      live.rerender(<MarkdownText text={source} streaming />)
      live.rerender(<MarkdownText text={source} />)
      expect(live.container.textContent).toContain(tail)
      expect(live.container.querySelector('[data-animate-word="true"]')).not.toBeNull()

      const finalized = live.container.innerHTML
      live.rerender(<MarkdownText text={source} />)
      expect(live.container.innerHTML).toBe(finalized)
    })

    it(`${name}: mounting partway through a reply catches up`, () => {
      for (let cut = 0; cut <= source.length; cut += 5) {
        const live = render(<MarkdownText text={source.slice(0, cut)} streaming />)
        live.rerender(<MarkdownText text={source} streaming />)
        live.rerender(<MarkdownText text={source} />)
        expect(live.container.textContent, `mounted at ${cut}`).toContain(tail)
        live.unmount()
      }
    })
  }

  it('re-rendering an unchanged streaming text writes nothing further', () => {
    const partial = DOCS.prose.source.slice(0, 20)
    const live = render(<MarkdownText text={partial} streaming />)
    const once = live.container.innerHTML
    for (let repeat = 0; repeat < 5; repeat++) {
      live.rerender(<MarkdownText text={partial} streaming />)
    }
    expect(live.container.innerHTML).toBe(once)
  })

  it('re-rendering an unchanged settled text writes nothing further', () => {
    const live = render(<MarkdownText text={DOCS.prose.source} />)
    const once = live.container.innerHTML
    for (let repeat = 0; repeat < 3; repeat++) {
      live.rerender(<MarkdownText text={DOCS.prose.source} />)
    }
    expect(live.container.innerHTML).toBe(once)

    // A settled view swapped to a different settled source re-parses it.
    live.rerender(<MarkdownText text={DOCS.list.source} />)
    const other = render(<MarkdownText text={DOCS.list.source} />)
    expect(live.container.innerHTML).toBe(other.container.innerHTML)
  })

  it('a rewritten source reseeds instead of appending to the old one', () => {
    const live = render(<MarkdownText text={'alpha\n\nbeta'} streaming />)
    live.rerender(<MarkdownText text="a different reply" streaming />)
    live.rerender(<MarkdownText text="a different reply" />)
    expect(live.container.textContent).toBe('a different reply')
    expect(live.container.textContent).not.toContain('alpha')
  })

  it('a settled mount under StrictMode writes once, not twice', () => {
    // StrictMode invokes the mount effect twice. The second pass sees its own
    // write already recorded and must skip it rather than re-parse.
    const strict = render(<StrictMode><MarkdownText text={DOCS.table.source} /></StrictMode>)
    const plain = render(<MarkdownText text={DOCS.table.source} />)
    expect(strict.container.innerHTML).toBe(plain.container.innerHTML)
  })

  it('survives StrictMode double invocation while streaming', () => {
    const doc = DOCS.mixed.source
    const strict = render(
      <StrictMode><MarkdownText text={doc.slice(0, 30)} streaming /></StrictMode>,
    )
    strict.rerender(<StrictMode><MarkdownText text={doc} streaming /></StrictMode>)
    strict.rerender(<StrictMode><MarkdownText text={doc} /></StrictMode>)
    expect(strict.container.textContent).toContain(DOCS.mixed.tail)
    expect(strict.container.querySelector('[data-animate-word="true"]')).not.toBeNull()
  })

  it('keeps the final animated words mounted after their fade', () => {
    const doc = 'The final words fade in.'
    const live = render(<MarkdownText text="The final words" streaming />)

    live.rerender(<MarkdownText text={doc} />)
    const animatedWords = live.container.querySelectorAll('[data-animate-word="true"]')
    const animatedWord = animatedWords.item(animatedWords.length - 1)
    expect(animatedWord).not.toBeNull()
    expect(live.container.contains(animatedWord)).toBe(true)

    fireEvent.animationEnd(animatedWord)
    live.rerender(<MarkdownText text={doc} />)
    expect(live.container.contains(animatedWord)).toBe(true)
  })

  it('finalizes a terminal replacement in the streaming renderer', () => {
    const doc = 'A replacement supplied by the terminal projection.'
    const live = render(<MarkdownText text="An obsolete stream" streaming />)

    live.rerender(<MarkdownText text={doc} />)
    expect(live.container.textContent).toContain(doc)
    expect(live.container.querySelector('[data-animate-word="true"]')).not.toBeNull()

    const finalized = live.container.innerHTML
    live.rerender(<MarkdownText text={doc} />)
    expect(live.container.innerHTML).toBe(finalized)
  })
})
