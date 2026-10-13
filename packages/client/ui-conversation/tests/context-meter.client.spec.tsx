// @vitest-environment jsdom

/**
 * The context reading the composer's Options popup shows: the occupancy fold,
 * the ring glyph its row leads with, and the breakdown panel that row opens.
 * The row, its card and their dismissal belong to the popup shell
 * (ComposerOptions).
 */

import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@aeven/client-test-runtime'
import { en as commonEn, zh as commonZh } from '@aeven/client-locale/src/locales/index.ts'
import { ContextPanel, ContextRing, type ContextPanelProps } from '../src/client/input/ContextMeter.tsx'
import { contextOccupancy } from '../src/client/context-occupancy.ts'
import css from '../src/client/input/ContextMeter.module.css'
import { en, zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh) as ContextPanelProps['t']
const tEn = makeTranslate(en, commonEn) as ContextPanelProps['t']

const BREAKDOWN = { systemTokens: 120, toolsTokens: 21_500, messageTokens: 477_000 }

const segmentClass = css.segment
if (segmentClass === undefined) throw new Error('segment class missing from ContextMeter.module.css')

/** The reading the panel draws from, over the pressure fields a provider reports. */
function occupancy(pressure: Parameters<typeof contextOccupancy>[0]) {
  const context = contextOccupancy(pressure)
  if (context === null) throw new Error('occupancy needs both a numerator and a capacity')
  return context
}

function panel(context: ContextPanelProps['context'], breakdown: ContextPanelProps['breakdown'], translate = t) {
  return render(<ContextPanel context={context} breakdown={breakdown} t={translate} />)
}

describe('context occupancy', () => {
  it('computes occupancy only when both a numerator and capacity are known', () => {
    expect(contextOccupancy({ pressureTokens: 32_000, projectedTokens: 6_000, contextWindow: 128_000 }))
      .toEqual({ percent: 5, usedTokens: 6_000, contextWindow: 128_000 })
    expect(contextOccupancy({ pressureTokens: 32_000, contextWindow: 128_000 }))
      .toEqual({ percent: 25, usedTokens: 32_000, contextWindow: 128_000 })
    expect(contextOccupancy({ pressureTokens: 32_000 })).toBeNull()
    expect(contextOccupancy({ contextWindow: 128_000 })).toBeNull()
    expect(contextOccupancy(undefined)).toBeNull()
    expect(contextOccupancy({ pressureTokens: 300_000, contextWindow: 128_000 })?.percent).toBe(100)
  })
})

describe('context ring', () => {
  it('fills the arc to the occupancy it is handed', () => {
    const { container } = render(<ContextRing percent={25} />)
    const fill = container.querySelector('circle:last-of-type')
    const circumference = 2 * Math.PI * 5.5
    expect(fill?.getAttribute('stroke-dasharray')).toBe(`${circumference * 0.25} ${circumference}`)
  })
})

describe('context breakdown panel', () => {
  it('reads the occupancy, its figures, and the composition rows', () => {
    const view = panel(occupancy({ pressureTokens: 32_000, contextWindow: 128_000 }), BREAKDOWN)
    const body = view.container.textContent ?? ''
    expect(body).toContain('~32K / 128K')
    expect(body).toContain('25%')
    expect(body).toContain('上下文已用')
    expect(body).toContain('系统提示词~120')
    expect(body).toContain('工具~21.5K')
    expect(body).toContain('对话消息~477K')
    // The occupancy bar splits into one colored segment per composition row.
    expect(view.container.getElementsByClassName(segmentClass)).toHaveLength(3)
  })

  it('lets each locale own the headline word order around the reading', () => {
    // The reading follows the label in Chinese and leads it in English; both
    // headers read as one sentence rather than a concatenated fragment.
    expect(panel(occupancy({ pressureTokens: 32_000, contextWindow: 128_000 }), BREAKDOWN).container.textContent)
      .toMatch(/^上下文已用25%/)
    expect(panel(occupancy({ pressureTokens: 32_000, contextWindow: 128_000 }), BREAKDOWN, tEn).container.textContent)
      .toMatch(/^25%of context used/)
  })

  it('draws no bar segment at zero occupancy', () => {
    const view = panel(occupancy({ pressureTokens: 0, contextWindow: 128_000 }), BREAKDOWN)
    // `.segment` carries a min-width, so a zero-width part would still paint a
    // filled sliver over an empty context.
    expect(view.container.getElementsByClassName(segmentClass)).toHaveLength(0)
    expect(view.container.textContent).toContain('~0 / 128K')
  })

  it('reads the projected figure so a compaction shows at once', () => {
    // Same provider sample, a surface a compaction just shrank: the reading
    // follows the projection rather than the sample it is anchored to.
    const view = panel(occupancy({ pressureTokens: 32_000, projectedTokens: 3_000, contextWindow: 128_000 }), BREAKDOWN)
    expect(view.container.textContent).toContain('~3K / 128K')
    expect(view.container.textContent).toContain('2%')
  })

  it('omits the composition rows while the contextBreakdown projection is absent', () => {
    const view = panel(occupancy({ pressureTokens: 32_000, contextWindow: 128_000 }), undefined)
    expect(view.container.textContent).toContain('~32K / 128K')
    expect(view.container.textContent).not.toContain('系统提示词')
    expect(view.container.textContent).not.toContain('对话消息')
    // Without composition shares, the bar falls back to one plain segment.
    expect(view.container.getElementsByClassName(segmentClass)).toHaveLength(1)
  })
})
