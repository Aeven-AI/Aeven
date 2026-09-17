// Web e2e scenario: markdown tables in the message column. HyperMarkdown keeps
// every cell on one line, so a table wider than the 748px message column
// reaches its natural width by scrolling horizontally inside its wrapper
// rather than wrapping into the column. The scroll viewport is the message
// column — same width and same left edge as any other table's, at every
// viewport — so a table reaches its full width behind the scroll and never
// paints a cell outside the column the rest of the transcript occupies.
//
// Only a real engine lays out CSS tables, so the scroll and containment
// relations, the alignment relations, arrow-key scrolling, and the zoom/DPR
// arms are all measured in Chromium across viewport stops. The golden records
// relations and booleans, never pixels: absolute widths document the
// platform, not the behavior.
//
// Zero model calls: the transcript is a closed turn assembled through the
// Session API and seeded cold; a stray stream would fail loud with
// NO_ADAPTER.
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createMessage, createUserMessage } from '@aeven/llm'
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
} from '@aeven/session'
import type {} from '@aeven/session-title'
import {
  assertFixtureInventory,
  compareOrRefreshGolden,
  launchWebScaffold,
  seedSession,
  watchConsole,
  webSnapshotMode,
  type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/markdown-wide-table', import.meta.url))
const GEOMETRY_EXPECTED = fileURLToPath(
  new URL('./expected/markdown-wide-table/geometry.expected.md', import.meta.url),
)
const MODE = webSnapshotMode()
const SEED_ID = 'markdown-wide-table-web-e2e'
/** Painted into the final paragraph; the open barrier waits for it. */
const TAIL_MARKER = 'MWT_TABLES_DONE'

/**
 * First-header-cell markers identify each table without depending on CSS
 * module hashes or DOM order.
 */
const FILL_MARKER = 'MWT_FILL_C1'
const WIDE_MARKER = 'MWT_WIDE_C01'
const LONG_CELL_MARKER = 'MWT_LONGCELL_F1'
const MARKERS = [FILL_MARKER, WIDE_MARKER, LONG_CELL_MARKER]
/** Golden-facing names, in {@link MARKERS} order. */
const TABLE_NAMES = ['fill', 'wide', 'long-cell']

/**
 * Viewport sweep. The wide stops leave the transcript far wider than the
 * 748px message column — the spare width a breakout would have reached into,
 * and where an escaping cell would show; the narrow stop drops the transcript
 * below the message column. The sidebar is collapsed for the whole sweep (see
 * beforeAll), so the transcript width follows the viewport identically on
 * overlay- and classic-scrollbar platforms.
 */
const WIDTHS = [1680, 1100, 640]

/** A sentence long enough that three of them cannot sit unwrapped in the 748px column. */
const SENTENCE = 'This cell carries one full sentence so the unwrapped table is far wider than the message column.'
/** Unbroken path-like token (no scheme, so GFM does not autolink it and no anchor joins the tab order). */
const LONG_TOKEN = 'workspace/aeven/packages/client/ui-primitives/src/markdown/render.tsx/'.repeat(3)
const CJK_SENTENCE = '这个单元格包含一段较长的中文说明，用来验证长内容在窄列宽下按最小可读宽度换行而不是把列压缩到无法阅读。'

/** The assistant markdown: one 3-column fill, one 12-column wide, one long-cell table. */
function tablesMarkdown(): string {
  // Twelve columns of a length that cannot sit inside the 748px column on one
  // line. Cells never wrap (HyperMarkdown pins `white-space: nowrap`), so the
  // scroll this table is here to exercise only exists if its natural width
  // exceeds the column — short cell values would simply fit.
  const wideHeader = [
    WIDE_MARKER,
    ...Array.from({ length: 11 }, (_, i) => `column-${String(i + 2).padStart(2, '0')}-header`),
  ]
  const wideRow = (row: number): string[] =>
    Array.from(
      { length: 12 },
      (_, i) => `r${String(row)}-c${String(i + 1).padStart(2, '0')}-datum`,
    )
  return [
    'Three markdown tables exercise the wide-table layout rules.',
    '',
    `| ${FILL_MARKER} | Current approach | Proposed approach |`,
    '| --- | --- | --- |',
    `| Rendering | ${SENTENCE} | ${SENTENCE} |`,
    `| Memory | ${SENTENCE} | ${SENTENCE} |`,
    '',
    `| ${wideHeader.join(' | ')} |`,
    `|${' --- |'.repeat(12)}`,
    `| ${wideRow(1).join(' | ')} |`,
    `| ${wideRow(2).join(' | ')} |`,
    '',
    `| ${LONG_CELL_MARKER} | Value |`,
    '| --- | --- |',
    `| path | ${LONG_TOKEN} |`,
    `| 说明 | ${CJK_SENTENCE} |`,
    '',
    TAIL_MARKER,
  ].join('\n')
}

/** Build one closed, invariant-checked session fixture carrying the three tables. */
function wideTableFixture(): string {
  const session = Session.create(SessionId('markdown-wide-table-source'))
  const eventTimeOrigin = new Date().setHours(12, 0, 0, 0)
  session.append('turn/start', { turn: 1 })
  const user = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text: 'Show the wide-table layout scenarios.' }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  session.append('session/title', {
    title: 'Markdown wide tables',
    messageSeqs: [user.seq],
    source: { kind: 'fallback' },
  })
  session.append('step/start', { turn: 1, step: 1 })
  session.append('assistant/message', {
    turn: 1,
    step: 1,
    message: createMessage({
      role: 'assistant',
      content: [{ type: 'text', text: tablesMarkdown() }],
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
    }),
  }, { surfaceOp: 'append' })
  session.append('step/end', { turn: 1, step: 1 })
  session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
  const header = {
    type: 'session',
    version: SESSION_FORMAT_VERSION,
    id: '{{sessionId}}',
    createdAt: 0,
    cwd: '{{cwd}}',
  }
  return [
    JSON.stringify(header),
    // Spaced event times, as the sibling markdown fixtures pin them.
    ...session.snapshotEvents().map(event => JSON.stringify({
      ...event,
      time: eventTimeOrigin + event.seq * 1_000,
    })),
    '',
  ].join('\n')
}

/** One table's layout relations at the current viewport. */
interface TableReading {
  /** Identifying first-header-cell marker. */
  marker: string
  /** `scrollWidth - clientWidth` of the wrapper: the residual horizontal scroll. */
  overflow: number
  /** Wrapper content width. */
  clientWidth: number
  /** Rendered wrapper height; scrolling absorbs width, so it holds across the sweep. */
  height: number
  /** Renderer marked the table with the `md-table-wide` breakout hook. */
  wideHook: boolean
  /**
   * The scroll viewport's own left x. This is the edge scrolled-away columns
   * clip against, so it must stay on the message column for every table.
   */
  scrollerLeft: number
  /** The table's own left x, for the content-alignment relation. */
  tableLeft: number
}

/** Read all three tables' relations in one pass. */
function readTables(page: Page): Promise<TableReading[]> {
  return page.evaluate((markers) => {
    const wrappers = [...document.querySelectorAll<HTMLElement>('.table-scroll')]
    return markers.map((marker) => {
      const wrapper = wrappers.find(candidate => candidate.textContent?.includes(marker) ?? false)
      if (wrapper === undefined) throw new Error(`table wrapper ${marker} not rendered`)
      const table = wrapper.querySelector('table')
      if (table === null) throw new Error(`table ${marker} not rendered`)
      return {
        marker,
        overflow: wrapper.scrollWidth - wrapper.clientWidth,
        clientWidth: wrapper.clientWidth,
        height: wrapper.getBoundingClientRect().height,
        wideHook: wrapper.classList.contains('md-table-wide'),
        scrollerLeft: wrapper.getBoundingClientRect().left,
        tableLeft: table.getBoundingClientRect().left,
      }
    })
  }, MARKERS)
}

/** A sweep stop: the three tables' readings at one viewport width. */
interface TableStop {
  width: number
  tables: TableReading[]
}

/**
 * Close the details pane so the transcript spans the viewport. Open, it pins
 * the transcript to exactly the message column and every breakout relation
 * would go vacuous.
 * @param target - the page whose pane to close.
 */
async function closeDetailsPane(target: Page): Promise<void> {
  await target.getByRole('button', { name: 'Close details', exact: true }).waitFor({ timeout: 10_000 })
  await target.evaluate(() => {
    document.querySelector<HTMLElement>('button[aria-label="Close details"]')?.click()
  })
  // Closed details resolve to zero width but never unmount (ui-layout
  // columns contract), so the settled signal is the frame's collapse marker,
  // not the button's detachment.
  await target.waitForSelector('[data-details-collapsed]', { timeout: 5_000 })
}

/**
 * Render the golden body: relations only. `fills the column` is a wrapper with
 * no residual horizontal scroll, `scrolls` its complement, and `stays in the
 * column` whether the wrapper's viewport matches the first table's, which by
 * construction is exactly the message column.
 * @param stops - the measured stops, in sweep order.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(stops: TableStop[]): string {
  return [
    '# Markdown wide-table relations',
    '',
    '| viewport | table | fills the column | scrolls | stays in the column |',
    '| --- | --- | --- | --- | --- |',
    ...stops.flatMap((stop) => {
      const column = stop.tables[0]!
      return stop.tables.map((table, index) =>
        `| ${String(stop.width)}px | ${TABLE_NAMES[index]} | ${String(table.overflow <= 1)} `
        + `| ${String(table.overflow > 1)} `
        + `| ${String(Math.abs(table.clientWidth - column.clientWidth) < 1.5
          && Math.abs(table.scrollerLeft - column.scrollerLeft) < 1.5)} |`,
      )
    }),
  ].join('\n')
}

describe('web e2e: markdown tables scroll inside the message column', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, wideTableFixture(), SEED_ID)
    browser = await chromium.launch()
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    const groupRow = page.locator('[role="treeitem"]').first()
    await groupRow.waitFor({ timeout: 15_000 })
    await groupRow.click()
    const sessionRow = page.locator('[role="treeitem"]').nth(1)
    await sessionRow.waitFor({ timeout: 10_000 })
    await sessionRow.click()
    await page.getByText(TAIL_MARKER, { exact: true }).waitFor({ timeout: 15_000 })
    // Collapse the sidebar and close the details pane for the whole sweep:
    // classic-scrollbar platforms (Linux CI) lose ~15px of layout width,
    // which shifts how much of a narrow viewport the panes leave the
    // transcript and lands the narrow stop's readings far from the macOS
    // ones — and the details pane alone pins the transcript to exactly the
    // message column, which would make every breakout relation vacuous.
    // With both out of the equation the transcript follows the viewport
    // identically on every platform, which is what keeps one committed
    // golden true for all lanes.
    await page.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
    // JS click: after the transcript scrolled to its tail, the pane's close
    // button can sit under the sticky header where a pointer click is
    // intercepted; the pane itself is scaffolding, not the behavior under
    // test, so actionability adds nothing here.
    await closeDetailsPane(page)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  /**
   * Resize to a viewport and read the tables once layout settles (the frame
   * eases its column tracks, so a read straight after a resize can catch a
   * mid-transition width).
   * @param width - viewport width to settle at.
   * @returns the three tables' readings at that width.
   */
  const settleAt = async (width: number): Promise<TableReading[]> => {
    await page.setViewportSize({ width, height: 900 })
    // The wide wrapper follows the transcript width (the fill wrapper caps
    // at the message column and would report "settled" mid-transition).
    let previousWidth = -1
    await expect.poll(async () => {
      const current = (await readTables(page))[1]!.clientWidth
      const settled = current === previousWidth
      previousWidth = current
      return settled
    }, { timeout: 10_000 }).toBe(true)
    return readTables(page)
  }

  /** Sweep once; every assertion reads the same measurement. */
  let swept: Promise<TableStop[]> | undefined
  const sweep = (): Promise<TableStop[]> => {
    swept ??= (async () => {
      const stops: TableStop[] = []
      for (const width of WIDTHS) stops.push({ width, tables: await settleAt(width) })
      return stops
    })()
    return swept
  }

  it('scrolls every table inside the message column', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-wide-table'))
    const stops = await sweep()
    for (const stop of stops) {
      const [fill, wide, longCell] = stop.tables
      const columnWidth = fill!.clientWidth
      // HyperMarkdown keeps every cell on one line (`table td { white-space:
      // nowrap }`), so a table reaches its natural width behind the scroll
      // rather than wrapping into the column. Each of these three carries
      // content past the 748px column, so each scrolls: an ordinary
      // three-column table of full sentences…
      expect(fill!.overflow, `fill viewport ${String(stop.width)}`).toBeGreaterThan(1)
      // …a long unbroken token beside long CJK prose…
      expect(longCell!.overflow, `long-cell viewport ${String(stop.width)}`).toBeGreaterThan(1)
      // …and a twelve-column matrix.
      expect(wide!.overflow, `wide viewport ${String(stop.width)}`).toBeGreaterThan(1)
      // The hook is column-count static, present at every stop.
      expect(wide!.wideHook).toBe(true)
      expect(fill!.wideHook).toBe(false)
      expect(longCell!.wideHook).toBe(false)
      // #520: the scroll viewport is the message column at every viewport —
      // same width and same left edge as an ordinary table's. The extra
      // width lives behind the scroll, never outside the column, so no cell
      // paints where the surrounding transcript does not reach.
      expect(Math.abs(wide!.clientWidth - columnWidth), `contained at ${String(stop.width)}`).toBeLessThan(1.5)
      expect(
        Math.abs(wide!.scrollerLeft - fill!.scrollerLeft),
        `viewport left edge at ${String(stop.width)}`,
      ).toBeLessThan(1.5)
      expect(Math.abs(wide!.tableLeft - fill!.tableLeft), `alignment at ${String(stop.width)}`).toBeLessThan(1.5)
    }
    // Scrolling absorbs the whole width change, so a narrower column costs no
    // extra rows: every table keeps its height across the sweep.
    const widest = stops[0]!
    const narrowest = stops[stops.length - 1]!
    for (const [index, name] of TABLE_NAMES.entries()) {
      expect(
        Math.abs(narrowest.tables[index]!.height - widest.tables[index]!.height),
        `${name} height across the sweep`,
      ).toBeLessThan(1.5)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('keeps the wide table keyboard-scrollable', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-wide-table-keyboard'))
    await sweep()
    await settleAt(1680)
    const wide = page.locator('.table-scroll', { hasText: WIDE_MARKER })
    // Chromium makes scrollable containers keyboard-focusable by default;
    // arrow keys then scroll the focused wrapper.
    await wide.focus()
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => wide.evaluate(element => element.scrollLeft), { timeout: 5_000 })
      .toBeGreaterThan(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('holds the wide table viewport on the column once it is scrolled', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-wide-table-scrolled'))
    await sweep()
    const [fill] = await settleAt(1680)
    const wide = page.locator('.table-scroll', { hasText: WIDE_MARKER })
    // Scrolling is where a viewport wider than the column becomes visible:
    // cells clip against the viewport's edges, so a viewport reaching past
    // the column paints the scrolled-away columns in the space beyond it.
    // The viewport is what bounds them, so the viewport is what to measure.
    await wide.evaluate((element) => { element.scrollLeft = element.scrollWidth })
    await expect.poll(() => wide.evaluate(element => element.scrollLeft), { timeout: 5_000 })
      .toBeGreaterThan(0)
    const box = await wide.evaluate((element) => {
      // clientWidth on both sides: the sweep reads it too, and it excludes a
      // classic scrollbar's gutter, which the bounding rect would include.
      return { left: element.getBoundingClientRect().left, width: element.clientWidth }
    })
    expect(Math.abs(box.left - fill!.scrollerLeft)).toBeLessThan(1.5)
    expect(Math.abs(box.width - fill!.clientWidth)).toBeLessThan(1.5)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('keeps the fill/scroll relations under page zoom', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-wide-table-zoom'))
    await sweep()
    await settleAt(1100)
    try {
      await page.evaluate(() => { document.documentElement.style.zoom = '1.25' })
      await expect.poll(async () => {
        const [fill, wide, longCell] = await readTables(page)
        return fill!.overflow > 1 && longCell!.overflow > 1 && wide!.overflow > 1
      }, { timeout: 10_000 }).toBe(true)
    } finally {
      await page.evaluate(() => { document.documentElement.style.zoom = '' })
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('reports the same relations on a high-DPI page', async () => {
    const hidpiPage = await browser.newPage({
      viewport: { width: 1100, height: 900 },
      deviceScaleFactor: 2,
      locale: 'en-US',
    })
    const hidpiTripwire = watchConsole(hidpiPage)
    try {
      onTestFailed(() => saveFailureShot(hidpiPage, 'web-e2e-markdown-wide-table-hidpi'))
      await hidpiPage.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
      await hidpiPage.waitForSelector('[class*="frame"]', { timeout: 30_000 })
      const groupRow = hidpiPage.locator('[role="treeitem"]').first()
      await groupRow.waitFor({ timeout: 15_000 })
      await groupRow.click()
      const sessionRow = hidpiPage.locator('[role="treeitem"]').nth(1)
      await sessionRow.waitFor({ timeout: 10_000 })
      await sessionRow.click()
      await hidpiPage.getByText(TAIL_MARKER, { exact: true }).waitFor({ timeout: 15_000 })
      await hidpiPage.getByRole('button', { name: 'Collapse sidebar', exact: true }).click()
      await closeDetailsPane(hidpiPage)
      // The pane collapses ease over the layout transition: compare only a
      // settled reading (two consecutive equal wide-wrapper widths).
      let readings: TableReading[] = []
      let previousWide = -1
      await expect.poll(async () => {
        readings = await readTables(hidpiPage)
        const settled = readings[1]!.clientWidth === previousWide
        previousWide = readings[1]!.clientWidth
        return settled
      }, { timeout: 10_000 }).toBe(true)
      const baseline = (await sweep()).find(stop => stop.width === 1100)!
      const relations = (tables: TableReading[]) => tables.map(table => ({
        marker: table.marker,
        fills: table.overflow <= 1,
        breaksOut: table.clientWidth > tables[0]!.clientWidth + 8,
      }))
      expect(relations(readings)).toEqual(relations(baseline.tables))
      expect(hidpiTripwire.pageErrors).toEqual([])
    } finally {
      await hidpiPage.close()
    }
  }, 120_000)

  it('matches the committed geometry golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-markdown-wide-table-golden'))
    const stops = await sweep()
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(stops), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 120_000)

  it('commits exactly the fixtures it reads', async () => {
    // No model calls, so no replay log: the golden is the whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
