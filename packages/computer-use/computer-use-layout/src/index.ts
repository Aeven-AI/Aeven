/**
 * Layout: the geometry of a slide, computed rather than driven.
 *
 * Taken from the recipe catalog the Codex application ships — 41 slide layouts, each
 * a parameterised `run` over a declarative drawing API, with coordinates computed
 * from a declared grid rather than discovered by looking at the screen.
 *
 * The structural idea worth taking is that **layout is pure geometry**. A recipe
 * takes parameters and returns positioned shapes. It touches no application, needs no
 * tool, and — the part that matters here — is testable on any machine. So this module
 * is deliberately free of I/O: rendering the result to a file is a separate concern
 * with its own readiness requirements, and leaving the two apart is what makes the
 * interesting part verifiable today.
 *
 * That is also the answer to the question formatting raised earlier. A parameterised
 * layout verified through a document model is strictly better than an operation
 * sequence verified by pixels, because the assertion is about the *computed geometry*
 * rather than about what the screen happened to look like.
 *
 * @module @aeven/computer-use-layout
 */

/** A drawing surface, in the units the grid uses. */
export interface SlideSurface {
  width: number
  height: number
}

/** A rectangle on the slide. */
export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** One shape a layout produced. */
export interface LayoutShape {
  /** What the shape is for, which is how a layout is asserted. */
  role: 'background' | 'band' | 'title' | 'subtitle' | 'body' | 'bullet' | 'accent' | 'metric' | 'label'
  /** The text it carries, when it carries any. */
  text?: string
  box: Box
  /** Style the renderer should apply; a layout chooses, a renderer implements. */
  style: {
    fontSize?: number
    bold?: boolean
    align?: 'left' | 'center' | 'right'
    verticalAlign?: 'top' | 'middle' | 'bottom'
    fill?: string
    color?: string
  }
}

/**
 * The layout grid every recipe positions against.
 *
 * Declared rather than hard-coded per recipe, so a deck is internally consistent and
 * a layout can be reasoned about without reading it: a title band starts at
 * `marginX`, a bullet column is `columns` wide minus two margins, and every gap is a
 * multiple of `baseUnit`.
 */
export interface LayoutGrid {
  columns: number
  marginX: number
  marginY: number
  gutter: number
  rowHeight: number
  rowGap: number
  baseUnit: number
}

/** A 16:9 surface at 1366x768, which is the common presentation size. */
export const DEFAULT_SURFACE: SlideSurface = { width: 1366, height: 768 }

/**
 * The default grid.
 *
 * Values chosen to divide the 1366x768 surface evenly: 12 columns with an 80 unit
 * margin leaves 1206 of content, and every gap is a multiple of 8.
 */
export const DEFAULT_GRID: LayoutGrid = {
  columns: 12,
  marginX: 80,
  marginY: 64,
  gutter: 24,
  rowHeight: 72,
  rowGap: 16,
  baseUnit: 8,
}

/**
 * The content width a grid leaves between its margins.
 * @param grid - the grid to measure.
 * @param surface - the slide surface.
 * @returns the width in slide units.
 */
export function contentWidth(grid: LayoutGrid, surface: SlideSurface = DEFAULT_SURFACE): number {
  return surface.width - grid.marginX * 2
}

/**
 * The width of one column, excluding the gutters between columns.
 * @param grid - the grid to measure.
 * @param surface - the slide surface.
 * @returns the column width.
 */
export function columnWidth(grid: LayoutGrid, surface: SlideSurface = DEFAULT_SURFACE): number {
  return (contentWidth(grid, surface) - grid.gutter * (grid.columns - 1)) / grid.columns
}

/**
 * The left edge of a column span.
 * @param grid - the grid to measure.
 * @param start - the first column, zero-based.
 * @param surface - the slide surface.
 * @returns the left edge in slide units.
 */
export function columnLeft(grid: LayoutGrid, start: number, surface: SlideSurface = DEFAULT_SURFACE): number {
  return grid.marginX + start * (columnWidth(grid, surface) + grid.gutter)
}

/**
 * The width of a column span.
 * @param grid - the grid to measure.
 * @param span - how many columns the shape covers.
 * @param surface - the slide surface.
 * @returns the width in slide units.
 */
export function spanWidth(grid: LayoutGrid, span: number, surface: SlideSurface = DEFAULT_SURFACE): number {
  return span * columnWidth(grid, surface) + (span - 1) * grid.gutter
}

/**
 * Round a value to the grid's base unit.
 *
 * Layouts snap rather than float, so a shape's edge is a value a test can state
 * exactly and a reviewer can compare across recipes.
 * @param grid - the grid to snap to.
 * @param value - the raw value.
 * @returns the value rounded to the nearest base unit.
 */
export function snap(grid: LayoutGrid, value: number): number {
  return Math.round(value / grid.baseUnit) * grid.baseUnit
}

/** One slide to lay out. */
export interface SlideSpec {
  /** Which layout to use. */
  kind: 'cover' | 'section' | 'bullets' | 'agenda' | 'metrics' | 'quote' | 'two-column'
  title: string
  subtitle?: string
  items?: readonly string[]
  metrics?: readonly { value: string; label: string }[]
  left?: readonly string[]
  right?: readonly string[]
}

/** A layout's output: the shapes to draw, in draw order. */
export type Layout = readonly LayoutShape[]

/** Fill names, so a deck can be restyled without editing any layout. */
export interface LayoutFills {
  background: string
  band: string
  accent: string
}

/** Options a layout may vary. */
export interface LayoutOptions {
  grid?: LayoutGrid
  surface?: SlideSurface
  fills?: Partial<LayoutFills>
}

/**
 * Options with every value resolved.
 *
 * Fully required, not partly optional: a layout reading `fills.accent` should get a
 * string, and leaving it optional would force every use site to invent a fallback.
 */
export interface ResolvedLayoutOptions {
  grid: LayoutGrid
  surface: SlideSurface
  fills: LayoutFills
}

/**
 * Resolve a layout's options against the defaults.
 * @param options - the caller's options.
 * @returns every option resolved.
 */
/**
 * The background shape every layout starts with.
 *
 * Extracted because it was written out identically in five layouts, which is the kind
 * of repetition that hides a real divergence: a change meant for one layout would have
 * landed in whichever copies its author happened to find.
 * @param surface - the slide surface to cover.
 * @param fills - the resolved fills.
 * @returns the background shape.
 */
function backgroundShape(surface: SlideSurface, fills: LayoutFills): LayoutShape {
  return { role: 'background', box: { left: 0, top: 0, ...surface }, style: { fill: fills.background } }
}

/**
 * The standard left-aligned title.
 *
 * Three layouts place a title at the same box with the same style, so the geometry and
 * the typography are stated once rather than three times.
 * @param title - the title text.
 * @param grid - the resolved grid.
 * @param surface - the slide surface.
 * @returns the title shape.
 */
function titleShape(title: string, grid: LayoutGrid, surface: SlideSurface): LayoutShape {
  return {
    role: 'title',
    text: title,
    box: { left: grid.marginX, top: grid.marginY, width: contentWidth(grid, surface), height: grid.rowHeight },
    style: { fontSize: 32, bold: true, align: 'left', verticalAlign: 'middle' },
  }
}

/**
 * The full-width band two layouts share.
 * @param top - the band's top edge.
 * @param height - the band's height.
 * @param grid - the resolved grid.
 * @param surface - the slide surface.
 * @param fills - the resolved fills.
 * @returns the band shape.
 */
function bandShape(
  top: number,
  height: number,
  grid: LayoutGrid,
  surface: SlideSurface,
  fills: LayoutFills,
): LayoutShape {
  return {
    role: 'band',
    box: { left: grid.marginX, top, width: contentWidth(grid, surface), height },
    style: { fill: fills.band },
  }
}

function resolve(options: LayoutOptions): ResolvedLayoutOptions {
  return {
    grid: options.grid ?? DEFAULT_GRID,
    surface: options.surface ?? DEFAULT_SURFACE,
    fills: {
      background: options.fills?.background ?? 'background1',
      band: options.fills?.band ?? 'accent1',
      accent: options.fills?.accent ?? 'accent2',
    },
  }
}

/**
 * Lay out a title cover: a full background, a band, and centred title text.
 * @param slide - the slide's content.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function coverLayout(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  const { grid, surface, fills } = resolve(options)
  const bandHeight = snap(grid, surface.height * 0.3)
  const bandTop = snap(grid, (surface.height - bandHeight) / 2)
  return [
    backgroundShape(surface, fills),
    bandShape(bandTop, bandHeight, grid, surface, fills),
    {
      role: 'title',
      text: slide.title,
      box: { left: grid.marginX, top: bandTop + grid.rowGap, width: contentWidth(grid, surface), height: grid.rowHeight },
      style: { fontSize: 48, bold: true, align: 'center', verticalAlign: 'middle', color: 'white' },
    },
    ...slide.subtitle === undefined ? [] : [{
      role: 'subtitle' as const,
      text: slide.subtitle,
      box: { left: grid.marginX, top: bandTop + grid.rowGap + grid.rowHeight, width: contentWidth(grid, surface), height: grid.rowGap * 3 },
      style: { fontSize: 22, align: 'center' as const, verticalAlign: 'middle' as const, color: 'white' },
    }],
  ]
}

/**
 * Lay out a section divider: a narrow accent rail and a headline.
 * @param slide - the slide's content.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function sectionLayout(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  const { grid, surface, fills } = resolve(options)
  const railWidth = snap(grid, grid.baseUnit * 4)
  return [
    backgroundShape(surface, fills),
    { role: 'accent', box: { left: grid.marginX, top: grid.marginY, width: railWidth, height: surface.height - grid.marginY * 2 }, style: { fill: fills.accent } },
    {
      role: 'title',
      text: slide.title,
      box: {
        left: columnLeft(grid, 1, surface),
        top: snap(grid, surface.height / 2 - grid.rowHeight / 2),
        width: spanWidth(grid, 10, surface),
        height: grid.rowHeight,
      },
      style: { fontSize: 40, bold: true, align: 'left', verticalAlign: 'middle' },
    },
  ]
}

/**
 * Lay out a bullet list against a narrow left rail.
 *
 * The first layout in the catalog was an agenda with exactly this shape, and the
 * rail is what makes a list read as deliberate rather than as a default text box.
 * @param slide - the slide's content.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function bulletsLayout(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  const { grid, surface, fills } = resolve(options)
  const items = slide.items ?? []
  const listTop = snap(grid, grid.marginY + grid.rowHeight + grid.rowGap * 2)
  const railWidth = snap(grid, grid.baseUnit * 2)
  return [
    backgroundShape(surface, fills),
    titleShape(slide.title, grid, surface),
    { role: 'accent', box: { left: grid.marginX, top: listTop, width: railWidth, height: snap(grid, items.length * (grid.rowHeight * 0.6 + grid.rowGap)) }, style: { fill: fills.accent } },
    ...items.map((item, index) => ({
      role: 'bullet' as const,
      text: item,
      box: {
        left: snap(grid, grid.marginX + railWidth + grid.gutter),
        top: snap(grid, listTop + index * (grid.rowHeight * 0.6 + grid.rowGap)),
        width: snap(grid, contentWidth(grid, surface) - railWidth - grid.gutter),
        height: snap(grid, grid.rowHeight * 0.6),
      },
      style: { fontSize: 20, align: 'left' as const, verticalAlign: 'middle' as const },
    })),
  ]
}

/**
 * Lay out a metric strip: evenly sized figures with labels beneath.
 * @param slide - the slide's content.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function metricsLayout(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  const { grid, surface, fills } = resolve(options)
  const metrics = slide.metrics ?? []
  const count = Math.max(metrics.length, 1)
  const span = Math.floor(grid.columns / count)
  const stripTop = snap(grid, surface.height / 2 - grid.rowHeight)
  return [
    backgroundShape(surface, fills),
    titleShape(slide.title, grid, surface),
    ...metrics.flatMap((metric, index) => [
      {
        role: 'metric' as const,
        text: metric.value,
        box: {
          left: columnLeft(grid, index * span, surface),
          top: stripTop,
          width: spanWidth(grid, span, surface),
          height: grid.rowHeight * 1.5,
        },
        style: { fontSize: 54, bold: true, align: 'center' as const, verticalAlign: 'middle' as const, color: fills.accent },
      },
      {
        role: 'label' as const,
        text: metric.label,
        box: {
          left: columnLeft(grid, index * span, surface),
          top: snap(grid, stripTop + grid.rowHeight * 1.5),
          width: spanWidth(grid, span, surface),
          height: grid.rowHeight * 0.6,
        },
        style: { fontSize: 18, align: 'center' as const, verticalAlign: 'middle' as const },
      },
    ]),
  ]
}

/**
 * Lay out a pull quote: a large centred statement over a subdued band.
 * @param slide - the slide's content.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function quoteLayout(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  const { grid, surface, fills } = resolve(options)
  // The quote geometry is derived once and named, so the band and the body cannot
  // drift apart: the body starts exactly where the band ends.
  const bandTop = snap(grid, surface.height * 0.3)
  const bandHeight = snap(grid, surface.height * 0.34)
  const bodyTop = snap(grid, surface.height * 0.34)
  const bodyHeight = snap(grid, surface.height * 0.2)
  return [
    backgroundShape(surface, fills),
    bandShape(bandTop, bandHeight, grid, surface, fills),
    {
      role: 'body',
      text: slide.title,
      box: { left: grid.marginX, top: bodyTop, width: contentWidth(grid, surface), height: bodyHeight },
      style: { fontSize: 36, align: 'center', verticalAlign: 'middle', color: 'white' },
    },
    ...slide.subtitle === undefined ? [] : [{
      role: 'label' as const,
      text: slide.subtitle,
      box: { left: grid.marginX, top: snap(grid, surface.height * 0.56), width: contentWidth(grid, surface), height: grid.rowHeight * 0.7 },
      style: { fontSize: 18, align: 'center' as const, color: 'white' },
    }],
  ]
}

/**
 * Lay out two text columns with a shared title.
 * @param slide - the slide's content.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function twoColumnLayout(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  const { grid, surface, fills } = resolve(options)
  const left = slide.left ?? []
  const right = slide.right ?? []
  const top = snap(grid, grid.marginY + grid.rowHeight + grid.rowGap)
  const height = snap(grid, surface.height - top - grid.marginY)
  return [
    backgroundShape(surface, fills),
    titleShape(slide.title, grid, surface),
    { role: 'body', text: left.join('\n'), box: { left: columnLeft(grid, 0, surface), top, width: spanWidth(grid, 5, surface), height }, style: { fontSize: 20, align: 'left', verticalAlign: 'top' } },
    { role: 'body', text: right.join('\n'), box: { left: columnLeft(grid, 6, surface), top, width: spanWidth(grid, 6, surface), height }, style: { fontSize: 20, align: 'left', verticalAlign: 'top' } },
  ]
}

/** Every layout, keyed by the slide kind that selects it. */
export const LAYOUTS: Readonly<Record<SlideSpec['kind'], (slide: SlideSpec, options?: LayoutOptions) => Layout>> = {
  cover: coverLayout,
  section: sectionLayout,
  bullets: bulletsLayout,
  agenda: bulletsLayout,
  metrics: metricsLayout,
  quote: quoteLayout,
  'two-column': twoColumnLayout,
}

/**
 * Lay out one slide.
 * @param slide - the slide to lay out.
 * @param options - grid, surface and fills.
 * @returns the shapes to draw.
 */
export function layoutSlide(slide: SlideSpec, options: LayoutOptions = {}): Layout {
  return LAYOUTS[slide.kind](slide, options)
}

/**
 * Lay out a whole deck.
 * @param slides - the slides to lay out.
 * @param options - grid, surface and fills.
 * @returns one layout per slide, in order.
 */
export function layoutDeck(slides: readonly SlideSpec[], options: LayoutOptions = {}): Layout[] {
  return slides.map(slide => layoutSlide(slide, options))
}

/**
 * Whether every shape on a slide lies inside it.
 *
 * The assertion that makes a layout checkable without rendering it: a shape that
 * overflows the surface is wrong regardless of what it says, and this is a fact about
 * the computed geometry rather than about a screenshot.
 * @param layout - the shapes to check.
 * @param surface - the slide surface.
 * @returns the shapes that fall outside, empty when every shape fits.
 */
export function overflowing(layout: Layout, surface: SlideSurface = DEFAULT_SURFACE): LayoutShape[] {
  return layout.filter(shape =>
    shape.box.left < 0
    || shape.box.top < 0
    || shape.box.left + shape.box.width > surface.width
    || shape.box.top + shape.box.height > surface.height)
}

/**
 * Whether any two shapes on a slide overlap.
 *
 * Overlap is not always wrong — a title band sits over a background by design — so
 * this reports pairs rather than a verdict, and callers decide which roles may
 * legitimately coincide.
 * @param layout - the shapes to check.
 * @returns overlapping pairs, as role names.
 */
export function overlapping(layout: Layout): Array<[string, string]> {
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < layout.length; i++) {
    for (let j = i + 1; j < layout.length; j++) {
      const a = layout[i]
      const b = layout[j]
      if (a === undefined || b === undefined) {
        continue
      }
      const separated = a.box.left + a.box.width <= b.box.left
        || b.box.left + b.box.width <= a.box.left
        || a.box.top + a.box.height <= b.box.top
        || b.box.top + b.box.height <= a.box.top
      if (!separated) {
        pairs.push([a.role, b.role])
      }
    }
  }
  return pairs
}
