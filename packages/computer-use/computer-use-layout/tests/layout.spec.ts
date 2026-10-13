/**
 * Slide layout as pure geometry.
 *
 * The properties under test are the ones that make a layout checkable without
 * rendering it: every shape fits inside the surface, every edge lands on the grid,
 * the shapes a slide needs are all present, and the geometry responds to its
 * parameters rather than ignoring them. A screenshot could not establish any of this.
 */

import { describe, expect, it } from 'vitest'
import {
  bulletsLayout,
  columnLeft,
  columnWidth,
  contentWidth,
  coverLayout,
  DEFAULT_GRID,
  DEFAULT_SURFACE,
  layoutDeck,
  layoutSlide,
  LAYOUTS,
  metricsLayout,
  overlapping,
  overflowing,
  quoteLayout,
  snap,
  spanWidth,
  twoColumnLayout,
  type LayoutGrid,
  type LayoutShape,
  type SlideSpec,
} from '../src/index.ts'

const cover: SlideSpec = { kind: 'cover', title: 'The Cartographer of Small Hours', subtitle: 'A short story' }
const bullets: SlideSpec = { kind: 'bullets', title: 'Agenda', items: ['Solar system', 'Planet classes', 'Distance and scale'] }
const metrics: SlideSpec = { kind: 'metrics', title: 'Traction', metrics: [{ value: '4.2M', label: 'Revenue' }, { value: '18', label: 'Markets' }] }
const twoColumn: SlideSpec = { kind: 'two-column', title: 'Comparison', left: ['one', 'two'], right: ['three'] }

describe('the grid is internally consistent', () => {
  it('leaves a positive content width', () => {
    expect(contentWidth(DEFAULT_GRID)).toBeGreaterThan(0)
  })

  it('computes a positive column width', () => {
    expect(columnWidth(DEFAULT_GRID)).toBeGreaterThan(0)
  })

  it('places the first column at the left margin', () => {
    expect(columnLeft(DEFAULT_GRID, 0)).toBe(DEFAULT_GRID.marginX)
  })

  it('keeps the last column inside the right margin', () => {
    const right = columnLeft(DEFAULT_GRID, DEFAULT_GRID.columns - 1) + columnWidth(DEFAULT_GRID)
    expect(right).toBeLessThanOrEqual(DEFAULT_SURFACE.width - DEFAULT_GRID.marginX + 0.001)
  })

  it('makes a full-width span equal the content width', () => {
    expect(spanWidth(DEFAULT_GRID, DEFAULT_GRID.columns)).toBeCloseTo(contentWidth(DEFAULT_GRID), 6)
  })

  it('grows a span monotonically', () => {
    expect(spanWidth(DEFAULT_GRID, 4)).toBeGreaterThan(spanWidth(DEFAULT_GRID, 3))
  })

  it('snaps to the base unit', () => {
    expect(snap(DEFAULT_GRID, 130)).toBe(128)
    expect(snap(DEFAULT_GRID, 133)).toBe(136)
    expect(snap(DEFAULT_GRID, 0)).toBe(0)
  })
})

describe('every layout keeps its shapes on the slide', () => {
  const slides: SlideSpec[] = [
    cover,
    { kind: 'section', title: 'Part one' },
    bullets,
    { kind: 'agenda', title: 'Agenda', items: ['a', 'b'] },
    metrics,
    { kind: 'quote', title: 'A promise', subtitle: 'Mara' },
    twoColumn,
    { kind: 'two-column', title: 'Empty' },
  ]

  it('has no overflowing shape, for any layout', () => {
    for (const slide of slides) {
      expect(overflowing(layoutSlide(slide)), slide.kind).toEqual([])
    }
  })

  it('has no overflowing shape on an empty bullet list', () => {
    expect(overflowing(bulletsLayout({ kind: 'bullets', title: 'Nothing' }))).toEqual([])
  })

  it('has no overflowing shape with a very long title', () => {
    const long = 'A title that is deliberately much longer than any real slide title would sensibly be, to see whether the layout still fits'
    expect(overflowing(coverLayout({ kind: 'cover', title: long }))).toEqual([])
  })

  it('reports an overflowing shape when one is forced out of bounds', () => {
    const shapes = [{ role: 'body' as const, box: { left: 0, top: 0, width: 9999, height: 10 }, style: {} }]
    expect(overflowing(shapes)).toHaveLength(1)
  })

  it('detects an off-slide shape in the negative direction and below the fold', () => {
    expect(overflowing([{ role: 'body', box: { left: -1, top: 0, width: 10, height: 10 }, style: {} }])).toHaveLength(1)
    expect(overflowing([{ role: 'body', box: { left: 0, top: 0, width: 10, height: 9999 }, style: {} }])).toHaveLength(1)
  })
})

describe('each layout produces what its slide needs', () => {
  it('gives a cover a background, a band, a title and a subtitle', () => {
    const roles = coverLayout(cover).map(shape => shape.role)
    expect(roles).toContain('background')
    expect(roles).toContain('band')
    expect(roles).toContain('title')
    expect(roles).toContain('subtitle')
  })

  it('omits the subtitle when the slide has none, rather than drawing an empty one', () => {
    expect(coverLayout({ kind: 'cover', title: 'Solo' }).map(shape => shape.role)).not.toContain('subtitle')
  })

  it('gives bullets a rail and one shape per item', () => {
    const layout = bulletsLayout(bullets)
    expect(layout.filter(shape => shape.role === 'bullet')).toHaveLength(3)
    expect(layout.map(shape => shape.role)).toContain('accent')
  })

  it('gives metrics one value and one label per metric', () => {
    const layout = metricsLayout(metrics)
    expect(layout.filter(shape => shape.role === 'metric')).toHaveLength(2)
    expect(layout.filter(shape => shape.role === 'label')).toHaveLength(2)
  })

  it('gives a quote its attribution as a label, and omits it when the slide names none', () => {
    const attributed = quoteLayout({ kind: 'quote', title: 'A promise', subtitle: 'Mara' }).filter(shape => shape.role === 'label')
    expect(attributed).toHaveLength(1)
    expect(attributed[0]?.text).toBe('Mara')
    expect(quoteLayout({ kind: 'quote', title: 'A promise' }).map(shape => shape.role)).not.toContain('label')
  })

  it('gives a two-column slide exactly two body columns', () => {
    expect(twoColumnLayout(twoColumn).filter(shape => shape.role === 'body')).toHaveLength(2)
  })

  it('carries the slide text onto the shapes', () => {
    expect(coverLayout(cover).find(shape => shape.role === 'title')?.text).toBe(cover.title)
    expect(bulletsLayout(bullets).filter(shape => shape.role === 'bullet').map(shape => shape.text)).toEqual(bullets.items)
  })
})

describe('geometry responds to its parameters rather than ignoring them', () => {
  it('places the Nth bullet below the first', () => {
    const shapes = bulletsLayout(bullets).filter(shape => shape.role === 'bullet')
    expect(shapes[1]!.box.top).toBeGreaterThan(shapes[0]!.box.top)
    expect(shapes[2]!.box.top).toBeGreaterThan(shapes[1]!.box.top)
  })

  it('gives every bullet the same width, so a list reads as a list', () => {
    const widths = new Set(bulletsLayout(bullets).filter(shape => shape.role === 'bullet').map(shape => shape.box.width))
    expect(widths.size).toBe(1)
  })

  it('spreads metric columns across the slide', () => {
    const shapes = metricsLayout(metrics).filter(shape => shape.role === 'metric')
    expect(shapes[1]!.box.left).toBeGreaterThan(shapes[0]!.box.left)
  })

  it('lays out a metric strip of no metrics as nothing, rather than dividing by zero', () => {
    // The count floors at one so the column span stays defined, and the strip is
    // then empty: a slide with no figures gets an empty strip, not NaN geometry.
    const layout = metricsLayout({ kind: 'metrics', title: 'No figures' })
    expect(layout.filter(shape => shape.role === 'metric')).toEqual([])
    expect(layout.filter(shape => shape.role === 'label')).toEqual([])
    expect(overflowing(layout)).toEqual([])
  })

  it('places the second column to the right of the first', () => {
    const bodies = twoColumnLayout(twoColumn).filter(shape => shape.role === 'body')
    expect(bodies[1]!.box.left).toBeGreaterThan(bodies[0]!.box.left + bodies[0]!.box.width - 1)
  })

  it('honours a caller-supplied grid', () => {
    const wide: LayoutGrid = { ...DEFAULT_GRID, marginX: 200 }
    const layout = bulletsLayout(bullets, { grid: wide })
    expect(layout.find(shape => shape.role === 'title')?.box.left).toBe(200)
  })

  it('honours caller-supplied fills, so a deck restyles without editing a layout', () => {
    const layout = coverLayout(cover, { fills: { band: 'slate-900' } })
    expect(layout.find(shape => shape.role === 'band')?.style.fill).toBe('slate-900')
  })

  it('falls back to the default fills for the ones not supplied', () => {
    expect(coverLayout(cover, { fills: { band: 'x' } }).find(shape => shape.role === 'background')?.style.fill).toBe('background1')
  })
})

describe('overlap is reported, not judged', () => {
  it('reports a cover band over its background, which is by design', () => {
    const pairs = overlapping(coverLayout(cover))
    expect(pairs).toContainEqual(['background', 'band'])
  })

  it('reports no overlap between the shapes of a bullet list', () => {
    const layout = bulletsLayout(bullets).filter(shape => shape.role === 'bullet')
    expect(overlapping(layout)).toEqual([])
  })

  it('reports no overlap between metric columns', () => {
    expect(overlapping(metricsLayout(metrics).filter(shape => shape.role !== 'background'))).toEqual([])
  })

  it('reports nothing for a single shape', () => {
    expect(overlapping([{ role: 'body', box: { left: 0, top: 0, width: 1, height: 1 }, style: {} }])).toEqual([])
  })

  it('skips a position holding no shape instead of reading a box off it', () => {
    // A sparse array is a list whose length runs past its filled positions, and this
    // is a public function over any `Layout` a caller holds. Reading `box` from a hole
    // would throw, so the pair is skipped and the shapes that are there still compared.
    const shapes: LayoutShape[] = []
    shapes[0] = { role: 'background', box: { left: 0, top: 0, width: 10, height: 10 }, style: {} }
    shapes[2] = { role: 'title', box: { left: 2, top: 2, width: 4, height: 4 }, style: {} }
    expect(overlapping(shapes)).toEqual([['background', 'title']])
  })
})

describe('the deck and the dispatch table', () => {
  it('lays out a deck in order', () => {
    const deck = layoutDeck([cover, bullets])
    expect(deck).toHaveLength(2)
    expect(deck[1]?.map(shape => shape.role)).toContain('bullet')
  })

  it('has a layout for every kind, with no gaps', () => {
    const kinds: SlideSpec['kind'][] = ['cover', 'section', 'bullets', 'agenda', 'metrics', 'quote', 'two-column']
    for (const kind of kinds) {
      expect(typeof LAYOUTS[kind], kind).toBe('function')
    }
  })

  it('lays out an empty deck as nothing', () => {
    expect(layoutDeck([])).toEqual([])
  })

  it('treats agenda and bullets as the same layout, since they are', () => {
    expect(layoutSlide({ kind: 'agenda', title: 'A', items: ['x'] })).toEqual(
      layoutSlide({ kind: 'bullets', title: 'A', items: ['x'] }),
    )
  })
})
