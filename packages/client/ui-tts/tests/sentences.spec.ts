/**
 * Flattening a reply into speech, and cutting the growing text into fragments a reader can start on.
 * The expected strings are what a listener hears, so prose survives and Markdown scaffolding does not.
 */
import { describe, expect, it } from 'vitest'
import { minSegmentLength, takeSegments, toSpeechText } from '../src/client/sentences.ts'

describe('toSpeechText', () => {
  it('keeps the prose of headings, quotes and list items without their markers', () => {
    expect(toSpeechText('# Delivery\n> quoted line\n- first item\n1. numbered item')).toBe(
      'Delivery\nquoted line\nfirst item\nnumbered item',
    )
  })

  it('drops fenced code, including a fence still open when the stream stops', () => {
    expect(toSpeechText('Before\n```js\nconst answer = 42\n```\nAfter')).toBe('Before\n\nAfter')
    expect(toSpeechText('Text\n```\nconst answer = 42')).toBe('Text')
  })

  it('keeps link labels and inline code but not their targets or backticks', () => {
    expect(toSpeechText('See [the guide](https://example.com/guide) and run `pnpm test`')).toBe(
      'See the guide and run pnpm test',
    )
  })

  it('drops images and HTML tags', () => {
    expect(toSpeechText('Chart: ![bars](https://example.com/bars.png) here')).toBe('Chart: here')
    expect(toSpeechText('a <strong>bold</strong> claim')).toBe('a bold claim')
  })

  it('drops a table whole, cells included, and keeps the prose around it', () => {
    expect(toSpeechText('Voices:\n| Language | Voices |\n|---|---|\n| Dutch | 3 |\nDone.')).toBe(
      'Voices:\n\nDone.',
    )
  })

  it('unwraps emphasis and removes markers that never closed', () => {
    expect(toSpeechText('**Bold**, _italic_ and ~~struck~~ text')).toBe('Bold, italic and struck text')
    expect(toSpeechText('an unclosed *marker and a | pipe')).toBe('an unclosed marker and a pipe')
  })

  it('collapses the whitespace Markdown leaves behind', () => {
    expect(toSpeechText('\n\n  spaced   out\t\ttext  \n\n\n\nnext paragraph\n\n')).toBe(
      'spaced out text\n\nnext paragraph',
    )
  })

  it('returns nothing for text that only carried scaffolding', () => {
    expect(toSpeechText('```\ncode only\n```')).toBe('')
  })
})

describe('takeSegments', () => {
  it('ends a fragment at every finished sentence and keeps the unterminated remainder', () => {
    expect(takeSegments('One. Two. Three', 12)).toEqual({ segments: ['One.', 'Two.'], rest: ' Three' })
  })

  it('speaks an abbreviation with the sentence it belongs to', () => {
    expect(takeSegments('Mr. Smith arrived.', 12)).toEqual({ segments: ['Mr. Smith arrived.'], rest: '' })
    expect(takeSegments('i.e. it works.', 12)).toEqual({ segments: ['i.e. it works.'], rest: '' })
  })

  it('cuts at a clause once the clause carries enough text to speak', () => {
    expect(takeSegments('Hello there, my friend', 12)).toEqual({
      segments: ['Hello there,'],
      rest: ' my friend',
    })
  })

  it('waits for more text when the clause is too short to speak on its own', () => {
    expect(takeSegments('Hi, there now', 12)).toEqual({ segments: [], rest: 'Hi, there now' })
  })

  it('keeps a clause that ends the buffer instead of speaking it', () => {
    expect(takeSegments('Hello there friend, ', 12)).toEqual({
      segments: [],
      rest: 'Hello there friend, ',
    })
  })

  it('does not speak a fragment shorter than a word', () => {
    expect(takeSegments('A. Bc.', 12)).toEqual({ segments: ['A. Bc.'], rest: '' })
  })

  it('cuts a sentence that terminates without a following space', () => {
    expect(takeSegments('你好。世界！', 4)).toEqual({ segments: ['你好。', '世界！'], rest: '' })
  })

  it('cuts an over-long fragment at its last space', () => {
    const cut = takeSegments(`${'a'.repeat(50)} ${'b'.repeat(100)}`, 12)
    expect(cut.segments).toEqual(['a'.repeat(50)])
    expect(cut.rest).toBe('b'.repeat(100))
  })

  it('leaves an over-long unbroken run for the next cut', () => {
    const cut = takeSegments('x'.repeat(130), 12)
    expect(cut.segments).toEqual([])
    expect(cut.rest).toBe('x'.repeat(130))
  })

  it('moves past a long run of spaces instead of speaking an empty fragment', () => {
    const cut = takeSegments(`${' '.repeat(20)}${'x'.repeat(120)}`, 12)
    expect(cut.segments).toEqual([])
    expect(cut.rest).toBe('x'.repeat(120))
  })

  it('has nothing to cut from an empty buffer', () => {
    expect(takeSegments('', 12)).toEqual({ segments: [], rest: '' })
  })
})

describe('minSegmentLength', () => {
  it('allows a shorter fragment in Chinese, where characters carry more meaning', () => {
    expect(minSegmentLength('zh')).toBe(4)
    expect(minSegmentLength('en')).toBe(12)
    expect(minSegmentLength('nl')).toBe(12)
  })
})
