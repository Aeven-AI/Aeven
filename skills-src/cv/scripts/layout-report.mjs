/**
 * The page report the exporter prints after pagination: what each page holds, how full it is,
 * and, when the layout needs a change, the change to make in cv.json.
 *
 * `measureLayout` runs in the paginated page and reads every column's blocks (their first line of
 * text, and whether a block is a heading that keeps with the next one) and the space they use.
 * `layoutReport` runs in Node: it names each block's section by matching headings against the
 * CV's section titles, so the report and its advice speak in cv.json terms ("Education",
 * "kind": "list") whatever markup the design system writes.
 */

/** A last page filled less than this share reads as a page left almost empty. */
const SPARSE_LAST_PAGE = 0.35

/**
 * Runs in the page (serialised by Puppeteer, so it uses nothing outside its body).
 * @returns {{ overflow: string, lineHeight: number, pages: Array<Record<string, { used: number, room: number, blocks: Array<{ label: string, head: boolean }> }>> }}
 *   per page, the columns it has (`side`, `main`; a cover has none), the height their blocks use
 *   and the height they have, in CSS pixels.
 */
export function measureLayout() {
  const firstLine = (el) => (el.innerText || '').split('\n').map((s) => s.trim()).find(Boolean)?.slice(0, 60) ?? ''
  const sample = document.querySelector('[data-col] > .flow p')
  const style = sample ? getComputedStyle(sample) : null
  const lineHeight = style ? (parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4) : 16
  const pages = [...document.querySelectorAll('section.page')].map((page) => {
    const cols = {}
    for (const col of ['side', 'main']) {
      const flow = page.querySelector(`[data-col="${col}"] > .flow`)
      if (!flow) continue
      const pad = getComputedStyle(flow)
      const top = flow.getBoundingClientRect().top + parseFloat(pad.paddingTop)
      const room = flow.clientHeight - parseFloat(pad.paddingTop) - parseFloat(pad.paddingBottom)
      const blocks = [...flow.querySelectorAll(':scope > [data-block]')]
      const last = blocks.at(-1)
      cols[col] = {
        used: last ? Math.max(0, Math.round(last.getBoundingClientRect().bottom - top)) : 0,
        room: Math.round(room),
        blocks: blocks.map((b) => ({ label: firstLine(b), head: b.hasAttribute('data-keep') })),
      }
    }
    return cols
  })
  return { overflow: document.documentElement.dataset.overflow ?? '', lineHeight, pages }
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim()

/**
 * The report for one exported CV.
 * @param {ReturnType<typeof measureLayout>} layout - what {@link measureLayout} returned.
 * @param {object} cv - the CV from the HTML's `cv-data`, labels resolved.
 * @param {{ name: string, maxPages: number }} options - the file's name for the printed lines,
 *   and the page count above which the CV is too long.
 * @returns {{ lines: string[], warnings: string[] }} the page-by-page summary, and each change
 *   the CV needs; no warnings means the layout is done.
 */
export function layoutReport(layout, cv, { name, maxPages }) {
  const sections = [...(cv.sections ?? []), ...(cv.sidebar ?? [])]
  const known = new Map(sections.map((s) => [norm(s.title), s]))
  for (const key of ['about', 'profile', 'contact', 'skills', 'languages']) if (cv.labels?.[key]) known.set(norm(cv.labels[key]), { title: cv.labels[key] })

  // Name every block's section: a heading opens one, a block whose first line is a section title
  // is one; anything else belongs to the section open in its column.
  const open = { side: null, main: null }
  const pages = layout.pages.map((cols) => {
    const out = {}
    for (const [col, c] of Object.entries(cols)) {
      const groups = []
      for (const block of c.blocks) {
        const match = known.get(norm(block.label))
        const opens = block.head || match !== undefined
        // A column that starts mid-section carries on the section open on the page before.
        const continued = !opens && groups.length === 0 && open[col] !== null
        if (opens) open[col] = match ?? { title: block.label }
        const section = open[col] ?? { title: block.label }
        if (groups.at(-1)?.section !== section) groups.push({ section, continued })
      }
      out[col] = { ...c, groups, fill: c.room > 0 ? c.used / c.room : 0 }
    }
    return out
  })

  // A section that breaks across pages reads "Education → p4" where it starts and "Education cont." after.
  pages.forEach((p, i) => {
    for (const [col, c] of Object.entries(p)) {
      const next = pages[i + 1]?.[col]?.groups[0]
      const last = c.groups.at(-1)
      if (last && next?.continued && next.section === last.section) last.breaksTo = i + 2
    }
  })
  const describe = (groups) => groups.map((g) => `${g.section.title}${g.continued ? ' cont.' : ''}${g.breaksTo ? ` → p${g.breaksTo}` : ''}`).join(', ')
  const pageFill = (p) => Math.max(0, ...Object.values(p).map((c) => c.fill))

  const lines = [`${name}: ${pages.length} page${pages.length === 1 ? '' : 's'}`]
  pages.forEach((p, i) => {
    const cols = Object.values(p)
    if (!cols.length) { lines.push(`  page ${i + 1}  cover`); return }
    const what = describe(cols.flatMap((c) => c.groups))
    lines.push(`  page ${i + 1}  ${what || '(empty)'} · ${Math.round(pageFill(p) * 100)}% full`)
  })

  const warnings = []
  if (layout.overflow) warnings.push(`an entry is taller than its page (${layout.overflow}): shorten that entry's text or points`)
  if (pages.length > maxPages) warnings.push(`the CV runs to ${pages.length} pages, more than ${maxPages}: shorten the older entries or drop the oldest ones`)

  const last = pages.at(-1)
  const prev = pages.at(-2)
  if (last && prev && Object.keys(last).length && Object.keys(prev).length && pageFill(last) < SPARSE_LAST_PAGE) {
    let need = 0
    for (const [col, c] of Object.entries(last)) {
      if (!c.used) continue
      const before = prev[col]
      need = Math.max(need, c.used - (before ? before.room - before.used : 0))
    }
    const onLast = Object.values(last).flatMap((c) => c.groups)
    const moves = []
    for (const g of onLast) if (g.section.kind === 'timeline' && g.section.items.length > 1) moves.push(`set "${g.section.title}" to "kind": "list" (one line per entry)`)
    moves.push(`shorten "text" or drop a "points" line in the longest entries on pages ${pages.length - 1}–${pages.length}`)
    moves.push('or drop the oldest entry')
    const count = Math.max(1, Math.ceil(need / layout.lineHeight))
    warnings.push(`page ${pages.length} holds only ${describe(onLast)} (${Math.round(pageFill(last) * 100)}% full). To end on page ${pages.length - 1}, free about ${count} line${count === 1 ? '' : 's'}: ${moves.join('; ')}. If the person has more to tell, filling that page with another section works too.`)
  }
  return { lines, warnings }
}
