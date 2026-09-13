/** The secondary content size ladder: the tier under the body size, without 13px. */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FONT_SIZE, FONT_SIZE_MAX, FONT_SIZE_MIN, secondaryFontSize,
} from '../src/theme-settings.ts'

describe('secondaryFontSize', () => {
  it('steps one below 14 and two below 16, holding the 14px floor in between', () => {
    // The tier never lands on 13px: sizes 14 and 15 would both compute to it,
    // so they hold the floor and equal the body size instead.
    expect([12, 13, 14, 15, 16, 17].map(secondaryFontSize)).toEqual([11, 12, 14, 14, 14, 15])
  })

  it('stays under or level with the body size across the whole accepted range', () => {
    for (let size = FONT_SIZE_MIN; size <= FONT_SIZE_MAX; size++) {
      expect(secondaryFontSize(size)).toBeLessThanOrEqual(size)
      expect(secondaryFontSize(size)).not.toBe(13)
    }
  })

  it('keeps the default setting one step under the body', () => {
    expect(secondaryFontSize(DEFAULT_FONT_SIZE)).toBe(14)
  })
})
