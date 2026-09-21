/**
 * Reading semantic tool catalogs.
 *
 * The property under test is that an entry which cannot be read as a
 * family-prefixed operation is skipped, and that skipping it costs nothing to
 * the entries that follow.
 */

import { describe, expect, it, vi } from 'vitest'
import { readToolCatalog } from '../src/tools.ts'

/** The argument `String.prototype.split` is declared to take. */
type StringSplitter = {
  [Symbol.split](string: string, limit?: number): string[]
}

/** The native splitter, read as a value so the spy can fall through to it. */
const nativeSplit = Object.getOwnPropertyDescriptor(String.prototype, 'split')?.value as (
  this: string,
  separator?: StringSplitter | string | RegExp,
  limit?: number,
) => string[]

describe('a catalog entry with no operation pair', () => {
  it('skips it and keeps the entries that do carry an operation', () => {
    // A dotted name always splits into a prefix and an operation, so the guard is
    // reached only by holding `split` at the state it defends against.
    const split = vi.spyOn(String.prototype, 'split').mockImplementation(function (
      this: string,
      separator?: StringSplitter | string | RegExp,
      limit?: number,
    ) {
      if (this === 'CalcTools.' && separator === '.') {
        return []
      }

      // Every other split, including the ones this test file makes, is native.
      return nativeSplit.call(this, separator as StringSplitter, limit)
    })

    try {
      const { catalog } = readToolCatalog('libreoffice_calc.json', [
        { function: { name: 'CalcTools.' } },
        { function: { name: 'CalcTools.save' } },
      ])
      expect(catalog?.family).toBe('CalcTools')
      expect(catalog?.tools.map(tool => tool.operation)).toEqual(['save'])
    } finally {
      split.mockRestore()
    }
  })
})
