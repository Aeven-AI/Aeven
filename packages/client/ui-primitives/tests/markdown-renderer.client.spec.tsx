// @vitest-environment jsdom
// Renderer contract tests for MarkdownText: the semantic heading hierarchy
// (h1–h6), GFM table structure (a header row is mandatory — no headless
// tables), and diagram fences. A ```mermaid fence renders as a diagram, while
// raw HTML still cannot put one in the DOM: only a fence the renderer parsed
// reaches the diagram engine, never markup an author wrote.
// Companion coverage of parse/render internals lives in markdown.client.spec.tsx.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MarkdownText heading hierarchy', () => {
  it('maps markdown heading levels 1–6 to semantic h1–h6 elements in order', () => {
    // The little story's heading skeleton: one element per level, in order.
    const story = [
      '# The Little Spark',
      '## Chapter One: The Empty Room',
      '### The First Question',
      '#### A Tiny Confusion',
      '##### And So It Told One',
      '###### The End',
    ].join('\n')
    const { container } = render(<MarkdownText text={story} />)

    const headings = [...container.querySelectorAll('h1,h2,h3,h4,h5,h6')]
    expect(headings.map(heading => `${heading.tagName.toLowerCase()}:${heading.textContent}`))
      .toEqual([
        'h1:The Little Spark',
        'h2:Chapter One: The Empty Room',
        'h3:The First Question',
        'h4:A Tiny Confusion',
        'h5:And So It Told One',
        'h6:The End',
      ])
    // Levels stay distinct: none collapses into another.
    for (const level of [1, 2, 3, 4, 5, 6]) {
      expect(container.querySelectorAll(`h${level}`)).toHaveLength(1)
    }
  })

  it('preserves the authored hierarchy for a11y roles', () => {
    const markdown = [
      '# Title',
      '## Chapter A',
      '### Beat 1',
      '## Chapter B',
    ].join('\n')
    render(<MarkdownText text={markdown} />)

    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Chapter A' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 3, name: 'Beat 1' })).toBeTruthy()
    expect(screen.getByRole('heading', { level: 2, name: 'Chapter B' })).toBeTruthy()
  })
})

describe('MarkdownText tables', () => {
  it('promotes the first row to the header: every table has a thead (no headless tables)', () => {
    const markdown = [
      '| # | Chapter | Beat | Gist | Mood |',
      '| --- | --- | --- | --- | --- |',
      '| 1 | The Empty Room | The First Question | blank space | curious |',
    ].join('\n')
    const { container } = render(<MarkdownText text={markdown} />)

    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    // The GFM grammar mandates a header row, so a table can never be headless.
    expect(table?.querySelector('thead th')).not.toBeNull()
    expect([...table!.querySelectorAll('thead th')].map(th => th.textContent))
      .toEqual(['#', 'Chapter', 'Beat', 'Gist', 'Mood'])
    expect([...table!.querySelectorAll('tbody td')].map(td => td.textContent))
      .toEqual(['1', 'The Empty Room', 'The First Question', 'blank space', 'curious'])
  })

  it('never fabricates a table from a bare delimiter row (a header row is required)', () => {
    const { container } = render(<MarkdownText text={'| --- | --- |'} />)

    expect(container.querySelector('table')).toBeNull()
    // The pipes survive as literal paragraph text instead of a table shell.
    expect(container.querySelector('p')?.textContent).toBe('| --- | --- |')
  })

  it('applies delimiter-row alignment to header and body cells', () => {
    const markdown = [
      '| L | C | R |',
      '| :--- | :---: | ---: |',
      '| a | b | c |',
    ].join('\n')
    const { container } = render(<MarkdownText text={markdown} />)

    expect([...container.querySelectorAll('th')].map(th => th.style.textAlign))
      .toEqual(['left', 'center', 'right'])
    expect([...container.querySelectorAll('td')].map(td => td.style.textAlign))
      .toEqual(['left', 'center', 'right'])
  })

  it('marks wide comparison matrices (≥ 4 columns) with md-table-wide, keeping narrow tables fill-width', () => {
    const wide = [
      '| A | B | C | D |',
      '| --- | --- | --- | --- |',
      '| 1 | 2 | 3 | 4 |',
    ].join('\n')
    const narrow = [
      '| A | B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n')

    const wideView = render(<MarkdownText text={wide} />)
    expect(wideView.container.querySelector('.md-table-wide')).not.toBeNull()
    wideView.unmount()

    const narrowView = render(<MarkdownText text={narrow} />)
    expect(narrowView.container.querySelector('.md-table-wide')).toBeNull()
  })
})

describe('MarkdownText math diagnostics', () => {
  it('accepts an en dash without silencing other KaTeX strict warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const view = render(<MarkdownText text={'Range: $1–4$.'} />)

      expect(view.container.querySelector('.katex')).not.toBeNull()
      expect(warn).not.toHaveBeenCalled()

      view.rerender(<MarkdownText text={'Range: $1—4$.'} />)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(
        'Unrecognized Unicode character "—"',
      ))
    } finally {
      warn.mockRestore()
    }
  })
})

describe('MarkdownText diagram fences', () => {
  const MERMAID_SOURCE = [
    '```mermaid',
    'flowchart TD',
    '  A[Question] --> B{Answer}',
    '```',
  ].join('\n')

  it('renders a mermaid fence as a diagram, not a code block', () => {
    const { container } = render(<MarkdownText text={MERMAID_SOURCE} />)

    expect(container.querySelector('.mermaid-container')).not.toBeNull()
    // The source is handed to the diagram engine rather than shown as code.
    expect(container.querySelector('pre code')).toBeNull()
  })

  it('claims the fence as soon as it opens, before the closing fence arrives', () => {
    // Switching a streaming block from code to diagram at the closing fence
    // would remount it and restart the engine, so the diagram surface owns the
    // block from the moment the info string names it.
    const { container } = render(
      <MarkdownText text={'```mermaid\nflowchart TD\n  A --> B'} streaming />,
    )

    expect(container.querySelector('.mermaid-container')).not.toBeNull()
    expect(container.querySelector('pre code')).toBeNull()
  })

  it('still renders the math fence through KaTeX', () => {
    const { container } = render(<MarkdownText text={'```math\nx^2 + y^2 = z^2\n```'} />)

    expect(container.querySelector('.katex')).not.toBeNull()
  })

  it('leaves an unclaimed language as a code block', () => {
    const { container } = render(<MarkdownText text={'```graphviz\ndigraph {}\n```'} />)

    expect(container.querySelector('pre code')?.textContent).toContain('digraph {}')
    expect(container.querySelector('.mermaid-container')).toBeNull()
  })

  it('keeps raw HTML literal, so no markup can smuggle a diagram into the DOM', () => {
    // The diagram engine is reachable only through a parsed fence. Raw HTML is
    // never parsed at all, so an authored <div class="mermaid"> or <svg> stays
    // text no matter what the engine would have done with it.
    const source = [
      '<svg><circle r="10" /></svg>',
      '<img src="https://example.com/diagram.svg">',
      '<div class="mermaid">graph TD</div>',
      '<script>window.__pwned = true</script>',
    ].join('\n\n')
    const { container } = render(<MarkdownText text={source} />)

    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('.mermaid')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
    // The tags survive only as literal text, never as elements.
    expect(container.textContent).toContain('<svg>')
    expect(container.textContent).toContain('<div class="mermaid">')
    expect(container.textContent).toContain('<script>')
  })
})
