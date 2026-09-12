// Browser geometry for the sidebar session list. The list overflows once a few
// sessions are loaded, and it must do so without drawing a bar and without
// reserving the band one would otherwise take. The bar is hidden by the
// `no-scrollbar` opt-out the markup carries (ui-theme styles/scrollbar.css), so
// what this scenario measures is what an engine does with that declaration —
// a reserved band is invisible in an ARIA snapshot and a stray UA bar is
// invisible in headless chromium's paint.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, compareOrRefreshGolden, launchWebScaffold, seedSession, watchConsole,
  webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { newEnglishPage, saveFailureShot } from './support.ts'

const SEED = fileURLToPath(new URL('../../../snapshots/web/seeded-history/session.jsonl', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('../../../snapshots/web/sidebar-scrollbar', import.meta.url))
/** Geometry and resolved style are absent from ARIA snapshots, so this scenario records them directly. */
const GEOMETRY_EXPECTED = join(SNAPSHOT_DIR, 'geometry.expected.md')
const MODE = webSnapshotMode()
/** Enough rows that the list overflows the 800px-tall viewport's sidebar; the scenario asserts the overflow rather than trusting it. */
const SEED_COUNT = 24

/** Resolved scrollbar style and geometry of the sidebar session list. */
interface ListMetrics {
  /** `scrollbar-width` as the engine resolved it for the list. */
  standardWidth: string
  /** `scrollbar-color` as the engine resolved it for the list. */
  standardColor: string
  /** Whether the list actually overflows, so no reading below is vacuous. */
  overflows: boolean
  /** Border-box width minus client width: the space a bar reserved, 0 when none does. */
  band: number
  /** How far the first row's background stops short of the sidebar's own edge. */
  rowEdgeInset: number
  /** Left edge of the content area plus its width: where content may reach. */
  clientRight: number
  /** Right edge of the border box, which content reaches only with no band. */
  borderRight: number
}

/**
 * Measure the sidebar session list in the page.
 * @param page - the page under test.
 * @returns the list's resolved scrollbar style and the geometry a band would shape.
 */
function measureList(page: Page): Promise<ListMetrics> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Sessions"]')
    if (list === null) throw new Error('sidebar session list not in the DOM')
    const row = list.querySelector<HTMLElement>('[role="treeitem"]')
    if (row === null) throw new Error('no row in the sidebar list')
    const sidebarEdge = list.parentElement?.getBoundingClientRect().right
    if (sidebarEdge === undefined) throw new Error('sidebar session list has no layout parent')
    const style = getComputedStyle(list)
    const rect = list.getBoundingClientRect()
    return {
      standardWidth: style.scrollbarWidth,
      standardColor: style.scrollbarColor,
      overflows: list.scrollHeight > list.clientHeight,
      band: rect.width - list.clientWidth,
      rowEdgeInset: sidebarEdge - row.getBoundingClientRect().right,
      clientRight: rect.left + list.clientWidth,
      borderRight: rect.right,
    }
  })
}

/**
 * Measure only overflow and row inset, which remain observable when every
 * session is hidden under a collapsed workspace group.
 * @param page - the page under test.
 * @returns the list overflow state and first row's trailing inset.
 */
function measureRowInset(page: Page): Promise<Pick<ListMetrics, 'overflows' | 'rowEdgeInset'>> {
  return page.evaluate(() => {
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Sessions"]')
    if (list === null) throw new Error('sidebar session list not in the DOM')
    const row = list.querySelector<HTMLElement>('[role="treeitem"]')
    if (row === null) throw new Error('no row in the sidebar list')
    const sidebarEdge = list.parentElement?.getBoundingClientRect().right
    if (sidebarEdge === undefined) throw new Error('sidebar session list has no layout parent')
    return {
      overflows: list.scrollHeight > list.clientHeight,
      rowEdgeInset: sidebarEdge - row.getBoundingClientRect().right,
    }
  })
}

/**
 * Park the pointer over the session list or outside the sidebar entirely. The
 * column's pointer state used to decide whether a bar was drawn, so a scenario
 * that never moves the mouse can only ever measure one of them.
 * @param page - the page under test.
 * @param where - `list` to point at the session list, `away` for the far side
 * of the viewport (the conversation column).
 */
async function pointAt(page: Page, where: 'list' | 'away'): Promise<void> {
  const box = await page.locator('[role="tree"][aria-label="Sessions"]').boundingBox()
  if (box === null) throw new Error('sidebar session list has no layout box')
  const viewport = page.viewportSize()
  if (viewport === null) throw new Error('page has no viewport')
  const target = where === 'list'
    ? { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    : { x: viewport.width - 5, y: box.y + box.height / 2 }
  await page.mouse.move(target.x, target.y)
}

/**
 * Scroll the list the way a wheel or a trackpad does, and report how far it
 * moved.
 * @param page - the page under test.
 * @param by - pixels to add to the list's scroll offset.
 * @returns the offset the list moved by.
 */
function scrollListBy(page: Page, by: number): Promise<number> {
  return page.evaluate((delta) => {
    const list = document.querySelector<HTMLElement>('[role="tree"][aria-label="Sessions"]')
    if (list === null) throw new Error('sidebar session list not in the DOM')
    const before = list.scrollTop
    list.scrollTop += delta
    return list.scrollTop - before
  }, by)
}

/**
 * Reveal the seeded rows: every seeded session is unattached, so they all sit
 * in the collapsed Ungrouped bucket. Open the bucket, then use its transient
 * Show-more control because an open group intentionally renders only five
 * rows by default. Hand-rolled polling because
 * `expect.poll` is test-scoped and this runs in `beforeAll`.
 * @param page - the page under test.
 */
async function expandSeededSessions(page: Page): Promise<void> {
  const bucket = page.getByText('Ungrouped', { exact: true }).locator('..').locator('..')
  await bucket.waitFor({ timeout: 15_000 })
  const rows = page.locator('[role="tree"][aria-label="Sessions"] [role="treeitem"]')
  const deadline = Date.now() + 30_000
  for (;;) {
    if (await bucket.getAttribute('aria-expanded') !== 'true') {
      await page.getByText('Ungrouped', { exact: true }).click()
    }
    const showMore = page.getByRole('button', { name: /Show \d+ more sessions/ })
    if (await bucket.getAttribute('aria-expanded') === 'true'
      && await rows.count() <= SEED_COUNT / 2
      && await showMore.count() > 0) {
      await showMore.click()
    }
    if (await bucket.getAttribute('aria-expanded') === 'true' && await rows.count() > SEED_COUNT / 2) return
    if (Date.now() > deadline) {
      throw new Error(`Ungrouped bucket never revealed more than ${SEED_COUNT / 2} rows`)
    }
    await page.waitForTimeout(200)
  }
}

/**
 * Render platform-neutral differences and comparisons instead of absolute
 * coordinates that depend on sidebar width and font metrics.
 * @param light - metrics measured under the light palette.
 * @param dark - metrics measured under the dark palette.
 * @returns the golden body, without a trailing newline.
 */
function renderGeometry(light: ListMetrics, dark: ListMetrics): string {
  const palette = (name: string, metrics: ListMetrics): string[] => [
    `## ${name}`,
    '',
    `- scrollbar-width: ${metrics.standardWidth}`,
    `- scrollbar-color: ${metrics.standardColor}`,
    `- list overflows: ${String(metrics.overflows)}`,
    `- reserved band: ${String(metrics.band)}px`,
    `- row background inset from the sidebar edge: ${String(metrics.rowEdgeInset)}px`,
    `- content area ends at the border box: ${String(metrics.clientRight === metrics.borderRight)}`,
    '',
  ]
  return [
    '# Sidebar session list scrollbar',
    '',
    ...palette('Light palette', light),
    ...palette('Dark palette', dark),
  ].join('\n').trimEnd()
}

describe('web e2e: sidebar session list shows no scrollbar', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({})
    const fixture = await readFile(SEED, 'utf8')
    for (let index = 0; index < SEED_COUNT; index += 1) {
      await seedSession(scaffold, fixture, `sidebar-scrollbar-web-e2e-${String(index).padStart(2, '0')}`)
    }
    browser = await chromium.launch()
    // Shorter than the other scenarios' 1000px so SEED_COUNT rows overflow
    // the list with room to spare.
    page = await newEnglishPage(browser, 800)
    tripwire = watchConsole(page)
    await page.goto(scaffold.authenticatedUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await expandSeededSessions(page)
  }, 180_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('overflows without drawing a bar or reserving the band one would take', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-no-scrollbar-band'))
    // Vacuity guard: a list that does not overflow would satisfy every reading
    // below for the wrong reason.
    await expect.poll(async () => (await measureList(page)).overflows, { timeout: 10_000 }).toBe(true)
    const metrics = await measureList(page)
    expect(metrics.standardWidth).toBe('none')
    // The band the bar would have taken is the whole point of the opt-out: a
    // reserved strip is what the previous reveal could not give up.
    expect(metrics.band).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('gives the reserved band back to the rows and still scrolls', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-no-scrollbar-rows'))
    const metrics = await measureList(page)
    // Rows now reach the sidebar's own edge: the space the bar held is content.
    expect(metrics.rowEdgeInset).toBe(0)
    expect(metrics.clientRight).toBe(metrics.borderRight)
    // Hiding the bar must not disable the scrolling it was an affordance for.
    const moved = await scrollListBy(page, 200)
    expect(moved).toBeGreaterThan(0)
    await scrollListBy(page, -moved)
    expect((await measureList(page)).band).toBe(0)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('keeps the rows full width whether or not the list overflows', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-no-scrollbar-stable-inset'))
    expect(await measureRowInset(page)).toEqual({ overflows: true, rowEdgeInset: 0 })
    const bucket = page.getByText('Ungrouped', { exact: true }).locator('..').locator('..')
    await bucket.click()
    try {
      await expect.poll(async () => (await measureRowInset(page)).overflows, { timeout: 10_000 }).toBe(false)
      // No band means no reservation to gain or lose, so the row geometry is
      // the same in both states rather than shifting when overflow arrives.
      expect(await measureRowInset(page)).toEqual({ overflows: false, rowEdgeInset: 0 })
    } finally {
      await expandSeededSessions(page)
    }
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('draws no bar under the pointer either — no state brings it back', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-no-scrollbar-pointer'))
    // The pointer used to decide this: the column drew its bars while it was
    // inside and hid them after it left. Both positions now read the same.
    await pointAt(page, 'list')
    const hovered = await measureList(page)
    await pointAt(page, 'away')
    await page.waitForTimeout(2500) // past the old linger window
    const away = await measureList(page)
    expect(hovered).toMatchObject({ standardWidth: 'none', band: 0 })
    expect(away).toMatchObject({ standardWidth: 'none', band: 0 })
    expect(away.band).toBe(hovered.band)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('matches the committed geometry golden in both palettes', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-sidebar-no-scrollbar-golden'))
    const light = await measureList(page)
    await page.evaluate(() => { document.body.setAttribute('data-ds-dark-theme', '') })
    const dark = await measureList(page)
    await page.evaluate(() => { document.body.removeAttribute('data-ds-dark-theme') })
    await compareOrRefreshGolden(GEOMETRY_EXPECTED, renderGeometry(light, dark), MODE)
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)

  it('commits exactly the fixtures it reads', async () => {
    // The scenario borrows seeded-history's session.jsonl rather than committing a
    // second copy, so this directory holds the golden alone.
    await assertFixtureInventory(SNAPSHOT_DIR, ['geometry.expected.md'])
  })

  it.skipIf(MODE === 'record')('issued zero model calls and stayed clean', () => {
    expect(tripwire.warnings).toEqual([])
    expect(tripwire.pageErrors).toEqual([])
  })
})
