// Browser geometry for the input card across Chat and Trajectory. The
// scrollport floats its bar, so each tab's card sits on the transcript's own
// axis; a control that forces a layout-consuming bar back onto Chat while
// dropping its reservation keeps those equal-axis readings from passing
// vacuously.
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import { createChatScrollFixture } from './chat-scroll-fixture.ts'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SNAPSHOT_DIR = fileURLToPath(new URL('./expected/composer-tab-geometry', import.meta.url))
/** Records platform-neutral distances between the two tabs' card rectangles. */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()

/** Long enough that the transcript overflows the lane's 1000px viewport; the scenario asserts the overflow rather than trusting it. */
const FIXTURE = createChatScrollFixture({
  markerPrefix: 'TAB_GEOMETRY',
  title: 'COMPOSER_TAB_GEOMETRY long session',
  turns: 24,
})
const SEED_ID = 'composer-tab-geometry-web-e2e'

/** Viewport widths the scenario measures at: the card capped, and the card shrinking with the column. */
const WIDE_VIEWPORT = { width: 1680, height: 1000 }
const NARROW_VIEWPORT = { width: 800, height: 1000 }

/**
 * Resize to one measurement viewport after the responsive sidebar and center
 * column finish their track transition.
 * @param page - the page under test.
 * @param viewport - the viewport dimensions to apply.
 * @param sidebarCollapsed - the sidebar state expected at this width.
 */
async function setMeasuredViewport(
  page: Page,
  viewport: { width: number; height: number },
  sidebarCollapsed: boolean,
): Promise<void> {
  await page.setViewportSize(viewport)
  await page.locator('[data-sidebar-collapsed="true"]').waitFor({
    state: sidebarCollapsed ? 'attached' : 'detached',
    timeout: 10_000,
  })
  await page.locator('[data-conversation-scroll]').evaluate(async (host) => {
    const deadline = performance.now() + 5_000
    let previous = host.getBoundingClientRect().width
    let stableFrames = 0
    while (performance.now() < deadline) {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve() }) })
      const current = host.getBoundingClientRect().width
      stableFrames = Math.abs(current - previous) < 0.01 ? stableFrames + 1 : 0
      if (stableFrames >= 3) return
      previous = current
    }
    throw new Error('conversation width did not settle after the viewport changed')
  })
}

/**
 * The control cascade, injected into the page: it takes the standard
 * scrollbar properties away from the Chat scrollport, which hands the box back
 * to the `::-webkit-scrollbar` fallback sheet and forces a layout-consuming bar
 * onto it, and drops the gutter that had reserved the same strip symmetrically.
 * The reservation is what keeps the transcript on the composer's axis, so
 * without it the transcript column slides by the bar's width while the card
 * stays on the box's axis. `!important` beats the module rules without a
 * rebuild, and the id lets the control be lifted again in the same session.
 */
const CONTROL_STYLE_ID = 'composer-tab-geometry-control'
const CONTROL_CSS = `
[data-conversation-scroll] {
  scrollbar-width: auto !important;
  scrollbar-color: auto !important;
  scrollbar-gutter: auto !important;
}
[data-conversation-scroll]::-webkit-scrollbar {
  width: 15px !important;
  height: 15px !important;
}
`

/**
 * The column scroller and the input card as the browser lays them out, in one
 * tab. Readable on either tab: the seat is a flex sibling of the scrollport and
 * the card is the same resident slot, so both survive a tab switch.
 */
interface TabMetrics {
  gutter: string
  overflowX: string
  overflowY: string
  band: number
  scrolls: boolean
  cardLeft: number
  cardRight: number
  cardWidth: number
}

/**
 * The transcript's content column and the card in the tab currently shown.
 * Readable only while Chat is elected: Chat's rows leave the DOM with the view.
 */
interface ColumnMetrics {
  /** Centre of the transcript's content column: the axis the card has to ride. */
  columnCentre: number
  /** Centre of the composer card, whose own box spans the whole column. */
  cardCentre: number
}

/** One tab's metrics beside the other's, plus the distances between them. */
interface TabComparison {
  chat: TabMetrics
  trajectory: TabMetrics
  leftShift: number
  rightShift: number
  widthShift: number
  /** How far the card's centre sits from the transcript column's centre in Chat. */
  axisShift: number
}

/** The flow row whose centre stands in for the transcript column's axis. */
const ROW_INDEX = 3

/**
 * Measure the column scroller and the input card in the tab currently shown.
 *
 * The seat is a flex sibling of the scrollport, not a descendant, so the card
 * is found from the document. Nothing here waits for a view: the scrollport and
 * the seat are the same two elements under either tab, and it is the caller that
 * waits for the elected view.
 * @param page - the page under test.
 * @returns the scroller's resolved overflow style and the card's rectangle.
 */
function measureTab(page: Page): Promise<TabMetrics> {
  return page.evaluate(() => {
    const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')
    if (host === null) throw new Error('conversation column scroller not in the DOM')
    const card = document.querySelector<HTMLElement>('[data-composer-seat] [data-composer-card]')
    if (card === null) throw new Error('no input card inside the composer seat')
    const style = getComputedStyle(host)
    const hostRect = host.getBoundingClientRect()
    const cardRect = card.getBoundingClientRect()
    return {
      gutter: style.scrollbarGutter,
      overflowX: style.overflowX,
      overflowY: style.overflowY,
      band: hostRect.width - host.clientWidth,
      scrolls: host.scrollHeight > host.clientHeight,
      cardLeft: cardRect.left,
      cardRight: cardRect.right,
      cardWidth: cardRect.width,
    }
  })
}

/**
 * Measure the transcript's content column against the card, in the tab
 * currently shown.
 *
 * The content column is read as the centre of a mounted flow row, which excludes
 * the scrollport's own padding and reserved band; a row's own centre is
 * scroll-invariant, so two reads cannot differ merely because the transcript
 * moved. Chat's rows are present exactly while Chat is the elected view, so this
 * is called after that view has been shown.
 * @param page - the page under test.
 * @returns the column's centre and the card's centre.
 */
async function measureColumn(page: Page): Promise<ColumnMetrics> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const measured = await page.evaluate((index): ColumnMetrics | null => {
      const host = document.querySelector<HTMLElement>('[data-conversation-scroll]')
      const card = document.querySelector<HTMLElement>('[data-composer-seat] [data-composer-card]')
      if (host === null || card === null) return null
      const row = [...host.querySelectorAll<HTMLElement>('[data-chat-anchor-key]:not([hidden])')][index]
      if (row === undefined) return null
      const rowRect = row.getBoundingClientRect()
      const cardRect = card.getBoundingClientRect()
      return {
        columnCentre: rowRect.left + rowRect.width / 2,
        cardCentre: cardRect.left + cardRect.width / 2,
      }
    }, ROW_INDEX)
    if (measured !== null) return measured
    await page.waitForTimeout(50)
  }
  throw new Error('the elected view never laid out a transcript row to measure')
}

/**
 * Show one tab and wait for the view that owns it to be laid out.
 *
 * Selecting a tab is asynchronous: the tab strip flips `aria-selected` on the
 * click, and the elected view mounts on a later commit. The wait is therefore
 * on the view's own content — and a click that did not land is retried rather
 * than reported as a layout failure, because a tab switch abandoned mid-flight
 * is a UI timing artifact, not the geometry this scenario measures.
 * @param page - the page under test.
 * @param tab - the tab to show.
 */
async function showTab(page: Page, tab: 'Chat' | 'Trajectory'): Promise<void> {
  const tabButton = page.getByRole('tab', { name: tab, exact: true })
  const trace = page.locator('[data-conversation-scroll] [data-chat-anchor-key]:visible')
  const deadline = Date.now() + 30_000
  for (;;) {
    if (await tabButton.getAttribute('aria-selected') !== 'true') await tabButton.click()
    const mounted = tab === 'Trajectory'
      ? await page.getByLabel('Trajectory timeline').isVisible().catch(() => false)
      : await trace.count() > ROW_INDEX
    if (mounted) break
    if (Date.now() > deadline) throw new Error(`${tab} view never mounted after selecting its tab`)
    await page.waitForTimeout(200)
  }
  // Both measurements are taken after a paint, so a rectangle read mid-transition
  // cannot be reported as a shift the cascade did not cause.
  await page.evaluate(() => new Promise<void>((settle) => {
    requestAnimationFrame(() => { requestAnimationFrame(() => { settle() }) })
  }))
}

/**
 * Measure both tabs and the distances between them, leaving Trajectory shown.
 *
 * Chat is read first and Trajectory second because only one view is mounted at a
 * time: Chat's rows leave the DOM once Trajectory is elected, so reading Chat's
 * axis after the switch would read a tab that is no longer there.
 * @param page - the page under test.
 * @returns each tab's metrics and the card's displacement between them.
 */
async function compareTabs(page: Page): Promise<TabComparison> {
  await showTab(page, 'Chat')
  const chat = await measureTab(page)
  const column = await measureColumn(page)
  await showTab(page, 'Trajectory')
  const trajectory = await measureTab(page)
  return {
    chat,
    trajectory,
    leftShift: Math.abs(trajectory.cardLeft - chat.cardLeft),
    rightShift: Math.abs(trajectory.cardRight - chat.cardRight),
    widthShift: Math.abs(trajectory.cardWidth - chat.cardWidth),
    axisShift: Math.abs(column.cardCentre - column.columnCentre),
  }
}

/** Chat's card and transcript axis with the control cascade applied. */
interface ControlMetrics extends TabMetrics, ColumnMetrics {}

/**
 * Run the control cascade in the page for one Chat reading, then lift it: the
 * scrollport carries a layout-consuming bar it no longer reserves, so the
 * transcript column slides off the composer's axis while the card keeps the
 * seat's width.
 * @param page - the page under test.
 * @returns the Chat reading as the column lays out with an unreserved bar.
 */
async function measureChatWithReservedBar(page: Page): Promise<ControlMetrics> {
  await page.evaluate(({ id, css }) => {
    const style = document.createElement('style')
    style.id = id
    style.textContent = css
    document.head.append(style)
  }, { id: CONTROL_STYLE_ID, css: CONTROL_CSS })
  try {
    return { ...await measureTab(page), ...await measureColumn(page) }
  } finally {
    await page.evaluate((id) => { document.getElementById(id)?.remove() }, CONTROL_STYLE_ID)
  }
}


/**
 * Open the seeded session from the sidebar search.
 *
 * Cold summaries carry the temp workspace's basename, so the persisted first
 * message is the stable identity to search for, and the query itself drives the
 * lazy content-index reconciliation. Hand-rolled polling because `expect.poll`
 * is test-scoped and this runs in `beforeAll`.
 * @param page - the page under test.
 */
async function openSeededSession(page: Page): Promise<void> {
  // Search collapsed into a header action; expand it before filling.
  const searchButton = page.getByRole('button', { name: 'Search sessions' })
  if (await searchButton.getAttribute('aria-expanded') !== 'true') await searchButton.click()
  const search = page.getByRole('textbox', { name: 'Search sessions...', exact: true })
  await search.fill(FIXTURE.markers.user(1))
  const results = page.getByRole('tree', { name: 'Search results' }).getByRole('treeitem')
  const deadline = Date.now() + 60_000
  for (;;) {
    if (await results.count() === 1) break
    if (Date.now() > deadline) throw new Error('seeded session never appeared in the sidebar search results')
    await page.waitForTimeout(200)
  }
  await results.click()
}

/**
 * Render the golden body.
 * @param wide - comparison at the viewport where the card sits at its width cap.
 * @param narrow - comparison at the viewport where the card shrinks with the column.
 * @param chat - Chat's reading at the wide viewport with a layout-consuming bar forced onto it and its reservation dropped.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(wide: TabComparison, narrow: TabComparison, control: ControlMetrics): string {
  const section = (name: string, comparison: TabComparison): string[] => [
    `## ${name}`,
    '',
    `- Chat: scrollbar-gutter ${comparison.chat.gutter}, overflow ${comparison.chat.overflowX}/${comparison.chat.overflowY}`,
    `- Chat scroller scrolls: ${String(comparison.chat.scrolls)}`,
    `- Chat reserved band: ${String(comparison.chat.band)}px`,
    `- Trajectory: scrollbar-gutter ${comparison.trajectory.gutter}, overflow ${comparison.trajectory.overflowX}/${comparison.trajectory.overflowY}`,
    `- Trajectory scroller scrolls: ${String(comparison.trajectory.scrolls)}`,
    `- Trajectory reserved band: ${String(comparison.trajectory.band)}px`,
    `- input card left edge moves between tabs: ${String(comparison.leftShift)}px`,
    `- input card right edge moves between tabs: ${String(comparison.rightShift)}px`,
    `- input card width changes between tabs: ${String(comparison.widthShift)}px`,
    `- transcript column centre sits off the card centre in Chat: ${String(comparison.axisShift)}px`,
    '',
  ]
  return [
    '# Input card position across the Chat and Trajectory tabs',
    '',
    ...section(`Wide viewport (${String(WIDE_VIEWPORT.width)}px, card at its cap)`, wide),
    ...section(`Narrow viewport (${String(NARROW_VIEWPORT.width)}px, card shrinking with the column)`, narrow),
    '## Wide viewport, layout-consuming bar forced onto Chat without a reservation (control)',
    '',
    `- Chat: scrollbar-gutter ${control.gutter}, overflow ${control.overflowX}/${control.overflowY}`,
    `- Chat scroller scrolls: ${String(control.scrolls)}`,
    `- Chat reserved band: ${String(control.band)}px`,
    `- input card left edge: ${String(control.cardLeft)}px`,
    `- input card right edge: ${String(control.cardRight)}px`,
    `- input card width: ${String(control.cardWidth)}px`,
    `- transcript column centre: ${String(control.columnCentre)}px`,
    `- input card centre: ${String(control.cardCentre)}px`,
    `- transcript column centre sits off the card centre in Chat: ${String(Math.abs(control.cardCentre - control.columnCentre))}px`,
  ].join('\n').trimEnd()
}

describe('web e2e: input card position across view tabs', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    await seedSession(scaffold, FIXTURE.log, SEED_ID)
    // Scrollbars must take layout space here or the comparison is vacuous.
    browser = await chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] })
    page = await newEnglishPage(browser, WIDE_VIEWPORT.height)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await openSeededSession(page)
    await page.getByRole('tab', { name: 'Chat', exact: true }).waitFor({ timeout: 30_000 })
    await page.getByText(FIXTURE.markers.assistant(FIXTURE.turns), { exact: false }).last()
      .waitFor({ timeout: 30_000 })
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('floats the bar in Chat and lets Trajectory own its width', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-band'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    // Vacuity guard. The scenario must be able to fail: on an engine that does
    // not implement the standard scrollbar properties the scrollport takes the
    // `::-webkit-scrollbar` path instead, which is the layout-consuming bar the
    // control test forces back on. `stable both-edges` reserves even without
    // overflow, so a short transcript is not a vacuous case; the poll still
    // pins the measurement to the overflowing state the product ships.
    await expect.poll(async () => (await measureTab(page)).scrolls, { timeout: 10_000 }).toBe(true)
    const comparison = await compareTabs(page)
    // `scrollbar-width: thin` asks chromium for an overlay bar, which reserves
    // no strip at all — the whole point of leaving the pseudo-element path. The
    // reservation below is therefore the gutter's, not a laid-out bar's.
    expect(comparison.chat.band).toBe(0)
    // Symmetric, so the transcript's content column rides the scrollport's own
    // axis. The seat is a flex sibling of that box, and the card's axis is what
    // both tabs have to agree on, which is what `axisShift` measures. On an
    // engine that does still reserve for a thin bar, `both-edges` is what keeps
    // this reading at zero; a one-sided `stable` would move the column by half
    // the reserved width and the control test measures exactly that shift.
    expect(comparison.chat.gutter).toBe('stable both-edges')
    expect(comparison.axisShift).toBe(0)
    // The overlay branch does NOT reserve: the view owns its own scrollers, so
    // a reserved gutter would only narrow the view's content on both edges.
    expect(comparison.trajectory.gutter).toBe('auto')
    expect(comparison.trajectory.band).toBe(0)
    // Declared as a scroll container on both axes rather than left to compute:
    // `overflow: hidden` would drop any reservation in WebKit, and a `visible`
    // horizontal axis computes to `auto` beside a scrolling one.
    expect(comparison.trajectory.overflowY).toBe('auto')
    expect(comparison.trajectory.overflowX).toBe('hidden')
    // Only Chat scrolls this box; the Trajectory view owns its own scrollers.
    expect(comparison.trajectory.scrolls).toBe(false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('holds the input card in place when the tab changes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-wide'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const comparison = await compareTabs(page)
    // The reported symptom as a number. At this viewport the card sits at its
    // width cap, so a scrollport that reserved a one-sided band would show up
    // as a centring difference — half the band on each edge — rather than as a
    // width change.
    expect(comparison.leftShift).toBe(0)
    expect(comparison.rightShift).toBe(0)
    expect(comparison.widthShift).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('holds the input card in place at a viewport where it shrinks with the column', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-narrow'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const capped = await measureTab(page)
    await setMeasuredViewport(page, NARROW_VIEWPORT, true)
    const comparison = await compareTabs(page)
    // The other geometry, and a different failure: below the cap the card takes
    // the column's width, so an unreserved gutter changes its WIDTH by the whole
    // band instead of shifting it by half. Asserted against the capped
    // measurement rather than against the cap's pixel value, which belongs to
    // the stylesheet.
    expect(comparison.chat.cardWidth).toBeLessThan(capped.cardWidth)
    expect(comparison.leftShift).toBe(0)
    expect(comparison.rightShift).toBe(0)
    expect(comparison.widthShift).toBe(0)
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('moves the transcript off the card once a laid-out bar is forced back on in the page', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-control'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    await showTab(page, 'Chat')
    const neutralCard = await measureTab(page)
    const neutralColumn = await measureColumn(page)
    // The control: without it, an equal transcript/card axis could also mean the
    // stylesheet moved neither. The injected cascade takes the standard
    // properties away from Chat's scrollport, which puts the layout-consuming
    // pseudo-element bar back, and drops the reservation that had held the
    // transcript on the composer's axis. Measured: band 15, gutter `auto`, and
    // the content column 7.5px left of the card's centre.
    const control = await measureChatWithReservedBar(page)
    expect(control.band).toBeGreaterThan(0)
    expect(control.gutter).toBe('auto')
    expect(control.cardCentre - control.columnCentre).toBe(control.band / 2)
    // The neutral read is the other half of the control: the same two elements
    // sit on one axis until the reservation goes.
    expect(neutralCard.band).toBe(0)
    expect(neutralColumn.cardCentre - neutralColumn.columnCentre).toBe(0)
    // The card is the side that must not change: the seat spans the box's full
    // width, so an unreserved bar moves only what scrolls inside it.
    expect(control.cardLeft).toBe(neutralCard.cardLeft)
    expect(control.cardRight).toBe(neutralCard.cardRight)
    expect(control.cardWidth).toBe(neutralCard.cardWidth)
    // Restoring the sheet restores the reservation, so the control cannot leak
    // into the remaining measurements.
    const restoredCard = await measureTab(page)
    const restoredColumn = await measureColumn(page)
    expect(restoredCard.band).toBe(0)
    expect(restoredColumn.cardCentre - restoredColumn.columnCentre).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('matches the committed tab geometry golden', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-composer-tab-geometry-golden'))
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    const wide = await compareTabs(page)
    await setMeasuredViewport(page, NARROW_VIEWPORT, true)
    const narrow = await compareTabs(page)
    await setMeasuredViewport(page, WIDE_VIEWPORT, false)
    // `compareTabs` leaves Trajectory elected, and the control reads Chat's own
    // transcript axis, so Chat has to be back on screen before it runs.
    await showTab(page, 'Chat')
    const control = await measureChatWithReservedBar(page)
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(wide, narrow, control), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('commits exactly the fixtures it reads', async () => {
    // The seeded session is generated in-process, so the geometry golden is the
    // whole inventory.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
