import { describe, expect, it } from 'vitest'
import { MAX_APP_MENU_ROWS, appMenuRows } from '../src/app-menu.ts'

const open = { type: 'row', id: 'open', label: 'Open' }

describe('app-page menu rows', () => {
  it('keeps the rows a page described, in display order', () => {
    expect(appMenuRows([
      open,
      { type: 'separator' },
      { type: 'row', id: 'copy', label: 'Copy Link', enabled: false },
    ])).toEqual([
      { type: 'row', id: 'open', label: 'Open' },
      { type: 'separator' },
      { type: 'row', id: 'copy', label: 'Copy Link', enabled: false },
    ])
  })

  it('refuses a list that is not a non-empty array of rows', () => {
    expect(() => appMenuRows(undefined)).toThrow('that is not a non-empty list')
    expect(() => appMenuRows([])).toThrow('that is not a non-empty list')
    expect(() => appMenuRows({ rows: [open] })).toThrow('that is not a non-empty list')
    expect(() => appMenuRows([null])).toThrow('row 0 that is not an object')
    expect(() => appMenuRows([{ type: 'item', id: 'a', label: 'A' }])).toThrow('row 0 naming an unknown type')
  })

  it('refuses a row without a usable id or label', () => {
    expect(() => appMenuRows([{ type: 'row', id: '', label: 'A' }])).toThrow('row 0 without an id')
    expect(() => appMenuRows([{ type: 'row', id: 'a'.repeat(65), label: 'A' }])).toThrow('row 0 without an id')
    expect(() => appMenuRows([{ type: 'row', id: 'a' }])).toThrow('row 0 without a label')
    expect(() => appMenuRows([{ type: 'row', id: 'a', label: 'L'.repeat(201) }])).toThrow('row 0 without a label')
    expect(() => appMenuRows([{ type: 'row', id: 'a', label: 'A', enabled: 'yes' }])).toThrow('row 0 with a non-boolean enabled')
  })

  it('refuses separators that separate nothing, and a repeated id', () => {
    expect(() => appMenuRows([{ type: 'separator' }, open])).toThrow('separator 0 with no rows to separate')
    expect(() => appMenuRows([open, { type: 'separator' }])).toThrow('separator 1 with no rows to separate')
    expect(() => appMenuRows([open, { type: 'separator' }, { type: 'separator' }, open])).toThrow('separator 2 with no rows to separate')
    expect(() => appMenuRows([open, { type: 'row', id: 'open', label: 'Again' }])).toThrow('naming id "open" twice')
  })

  it('refuses a separator carrying fields of its own', () => {
    expect(() => appMenuRows([{ type: 'separator', label: '—' }, open])).toThrow('separator 0 carrying a row')
  })

  it('refuses a list longer than the shell draws', () => {
    const rows = Array.from({ length: MAX_APP_MENU_ROWS + 1 }, (_value, index) => ({
      type: 'row' as const, id: `row-${String(index)}`, label: `Row ${String(index)}`,
    }))
    expect(() => appMenuRows(rows)).toThrow(`of more than ${String(MAX_APP_MENU_ROWS)} rows`)
  })
})
