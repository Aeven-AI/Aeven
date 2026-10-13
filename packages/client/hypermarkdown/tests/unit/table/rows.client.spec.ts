import { describe, expect, it } from 'vitest'

import { isTableRow, isTableText } from '../../../src/engine/table/rows.ts'

describe('isTableRow', () => {
  it.each([
    ['a plain row', '| a | b |'],
    ['a one-cell row', '| a |'],
    ['a row still arriving', '| a'],
    ['a delimiter row', '| --- | --- |'],
    ['a row indented up to three spaces', '   | a | b |'],
    ['a quoted row', '> | a | b |'],
    ['a nested quoted row', '> > | a | b |'],
    ['a quoted row with no space after the marker', '>| a | b |'],
    ['a tab-indented row', '\t| a | b |'],
  ])('accepts %s', (_name, line) => {
    expect(isTableRow(line)).toBe(true)
  })

  it.each([
    ['prose that carries one', 'the flag is a | b'],
    ['a row with no leading pipe', 'a | b |'],
    ['a bullet carrying a shell pipeline', '- ls -R | head -50'],
    ['a bullet carrying a regex alternation', '- `\\b(?:I|we)\\s+` needs "I"'],
    ['a line of code with a logical or', '}).filter(a => a.text || a.host);'],
    ['a row escaped at its first pipe', '\\| a | b |'],
    ['an indented code line', '    | a | b |'],
    ['a quoted continuation', '> prose | more'],
  ])('refuses %s', (_name, line) => {
    expect(isTableRow(line)).toBe(false)
  })
})

describe('isTableText', () => {
  it('accepts a run of rows', () => {
    expect(isTableText('| a | b |\n| c | d |')).toBe(true)
  })

  it('accepts a run with blank lines around it', () => {
    expect(isTableText('\n| a | b |\n\n| c | d |\n\n')).toBe(true)
  })

  it('accepts a single row', () => {
    expect(isTableText('| a | b |')).toBe(true)
  })

  it('refuses a run holding a line that is not a row', () => {
    expect(isTableText('| a | b |\nsome prose | here')).toBe(false)
  })

  it('refuses a run of list items', () => {
    expect(isTableText('- one | item\n- two | item')).toBe(false)
  })

  it('refuses text with no row at all', () => {
    expect(isTableText('plain prose')).toBe(false)
  })

  it('refuses text that is only blank lines', () => {
    expect(isTableText('  \n\n')).toBe(false)
  })
})
