/**
 * Charts for the `chart` slide kind, drawn as inline SVG in the design system's own palette and
 * fonts, so a chart reads as part of the template rather than a pasted image.
 *
 * Data (the slide's `chart` field):
 *   { type: 'column' | 'bar' | 'line' | 'area' | 'pie' | 'donut',
 *     labels: string[],                       categories, or pie/donut slices
 *     series: { name, values: number[] }[],   one value per label; pie/donut use the first series
 *     unit?: string,                          appended to value labels ("%", "k", " users")
 *     stacked?: boolean }                     column/bar only
 *
 * Style comes from the system: `palette` (ink, muted, rule, accents) and the deck fonts through the
 * `--font` CSS variable. The SVG scales to its box (viewBox 1000×520), so a layout sizes the box.
 */

const W = 1000
const H = 520

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A round axis maximum at or above `max`, and its tick step. */
function niceScale(max) {
  if (max <= 0) return { top: 1, step: 0.25 }
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)
  return { top: step * Math.ceil(max / step), step }
}

/** A value as the chart prints it: grouped digits, at most one decimal, plus the unit. */
const fmt = (v, unit = '') => `${Number.isInteger(v) ? v.toLocaleString('en-US') : v.toLocaleString('en-US', { maximumFractionDigits: 1 })}${unit}`

/** Throws when chart data is malformed, naming the field. */
export function validateChart(chart) {
  const types = ['column', 'bar', 'line', 'area', 'pie', 'donut']
  if (!types.includes(chart?.type)) throw new Error(`chart.type must be one of ${types.join(', ')}`)
  if (!Array.isArray(chart.labels) || chart.labels.length === 0) throw new Error('chart.labels must be a non-empty array')
  if (!Array.isArray(chart.series) || chart.series.length === 0) throw new Error('chart.series must be a non-empty array')
  chart.series.forEach((s, i) => {
    if (!Array.isArray(s.values) || s.values.length !== chart.labels.length || s.values.some((v) => typeof v !== 'number')) {
      throw new Error(`chart.series[${i}].values must hold one number per label`)
    }
  })
  return chart
}

/**
 * The chart as an SVG string.
 * @param {object} chart - validated chart data.
 * @param {{ ink: string, muted: string, rule: string, accents: string[] }} palette - the system's palette.
 * @returns {string} an `<svg>` element sized to fill its box.
 */
export function chartSvg(chart, palette) {
  validateChart(chart)
  const color = (i) => palette.accents[i % palette.accents.length]
  const text = (x, y, value, { anchor = 'middle', size = 20, fill = palette.muted, weight = 400 } = {}) =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${fill}" font-family="var(--font)">${esc(value)}</text>`
  const legend = chart.series.length > 1 && !['pie', 'donut'].includes(chart.type)
    ? chart.series.map((s, i) => `<g transform="translate(${W - 20 - (chart.series.length - i) * 190},0)"><rect width="18" height="18" rx="4" fill="${color(i)}"/>${text(28, 15, s.name, { anchor: 'start', size: 18, fill: palette.ink })}</g>`).join('')
    : ''
  const body = chart.type === 'pie' || chart.type === 'donut' ? pie(chart, palette, color, text) : axes(chart, palette, color, text)
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(chart.series.map((s) => s.name).join(', '))}">${legend}${body}</svg>`
}

/** Column, bar, line and area charts on a value axis. */
function axes(chart, palette, color, text) {
  const horizontal = chart.type === 'bar'
  const stacked = chart.stacked && (chart.type === 'column' || chart.type === 'bar')
  const n = chart.labels.length
  const totals = chart.labels.map((_, i) => chart.series.reduce((sum, s) => sum + Math.max(0, s.values[i]), 0))
  const max = stacked ? Math.max(...totals) : Math.max(...chart.series.flatMap((s) => s.values))
  const { top, step } = niceScale(max)
  const left = horizontal ? 200 : 70
  const right = W - 20
  const topY = chart.series.length > 1 ? 50 : 20
  const bottom = H - 50
  const out = []
  // Value grid: four or five rules with their values.
  for (let v = 0; v <= top + 1e-9; v += step) {
    if (horizontal) {
      const x = left + (v / top) * (right - left)
      out.push(`<line x1="${x}" y1="${topY}" x2="${x}" y2="${bottom}" stroke="${palette.rule}" stroke-width="1"/>`, text(x, bottom + 30, fmt(v, chart.unit), { size: 18 }))
    } else {
      const y = bottom - (v / top) * (bottom - topY)
      out.push(`<line x1="${left}" y1="${y}" x2="${right}" y2="${y}" stroke="${palette.rule}" stroke-width="1"/>`, text(left - 12, y + 6, fmt(v, chart.unit), { anchor: 'end', size: 18 }))
    }
  }
  const band = ((horizontal ? bottom - topY : right - left)) / n
  if (chart.type === 'column' || chart.type === 'bar') {
    const groups = stacked ? 1 : chart.series.length
    const barW = Math.min(band * 0.7 / groups, horizontal ? 56 : 90)
    chart.labels.forEach((label, i) => {
      const start = (horizontal ? topY : left) + band * i + (band - barW * groups) / 2
      let acc = 0
      chart.series.forEach((s, j) => {
        const v = Math.max(0, s.values[i])
        const len = (v / top) * (horizontal ? right - left : bottom - topY)
        const off = (acc / top) * (horizontal ? right - left : bottom - topY)
        const pos = start + (stacked ? 0 : j * barW)
        out.push(horizontal
          ? `<rect x="${left + off}" y="${pos}" width="${len}" height="${barW - 4}" rx="4" fill="${color(j)}"/>`
          : `<rect x="${pos}" y="${bottom - off - len}" width="${barW - 6}" height="${len}" rx="4" fill="${color(j)}"/>`)
        if (!stacked && chart.series.length === 1) {
          out.push(horizontal
            ? text(left + len + 10, pos + barW / 2 + 4, fmt(s.values[i], chart.unit), { anchor: 'start', size: 18, fill: palette.ink, weight: 600 })
            : text(pos + (barW - 6) / 2, bottom - len - 10, fmt(s.values[i], chart.unit), { size: 18, fill: palette.ink, weight: 600 }))
        }
        if (stacked) acc += v
      })
      out.push(horizontal
        ? text(left - 14, start + (barW * groups) / 2 + 6, label, { anchor: 'end', size: 19, fill: palette.ink })
        : text(left + band * i + band / 2, bottom + 30, label, { size: 19, fill: palette.ink }))
    })
  } else {
    const x = (i) => left + band * i + band / 2
    const y = (v) => bottom - (v / top) * (bottom - topY)
    chart.labels.forEach((label, i) => out.push(text(x(i), bottom + 30, label, { size: 19, fill: palette.ink })))
    chart.series.forEach((s, j) => {
      const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
      if (chart.type === 'area') out.push(`<polygon points="${x(0)},${bottom} ${pts} ${x(n - 1)},${bottom}" fill="${color(j)}" opacity="${chart.series.length > 1 ? 0.35 : 0.5}"/>`)
      out.push(`<polyline points="${pts}" fill="none" stroke="${color(j)}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"/>`)
      s.values.forEach((v, i) => out.push(`<circle cx="${x(i)}" cy="${y(v)}" r="6" fill="${color(j)}"/>`))
      if (chart.series.length === 1) s.values.forEach((v, i) => out.push(text(x(i), y(v) - 16, fmt(v, chart.unit), { size: 18, fill: palette.ink, weight: 600 })))
    })
  }
  return out.join('')
}

/** Pie and donut charts: slices of the first series with a legend of label, share and value. */
function pie(chart, palette, color, text) {
  const values = chart.series[0].values.map((v) => Math.max(0, v))
  const total = values.reduce((a, b) => a + b, 0) || 1
  const cx = 260, cy = H / 2, r = 220, inner = chart.type === 'donut' ? 130 : 0
  let angle = -Math.PI / 2
  const out = values.map((v, i) => {
    const a2 = angle + (v / total) * Math.PI * 2
    const large = a2 - angle > Math.PI ? 1 : 0
    const p = (a, rad) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`
    const d = inner
      ? `M${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} L${p(a2, inner)} A${inner},${inner} 0 ${large} 0 ${p(angle, inner)} Z`
      : `M${cx},${cy} L${p(angle, r)} A${r},${r} 0 ${large} 1 ${p(a2, r)} Z`
    angle = a2
    return `<path d="${v / total >= 0.9999 ? '' : d}" fill="${color(i)}"/>${v / total >= 0.9999 ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color(i)}"/>` : ''}`
  })
  // A donut of shares has nothing to total; a donut of amounts shows the sum in its hole.
  if (inner && chart.unit !== '%') out.push(text(cx, cy + 14, fmt(total, chart.unit), { size: 44, fill: palette.ink, weight: 700 }))
  const rowH = Math.min(64, (H - 40) / values.length)
  const startY = cy - (rowH * values.length) / 2
  chart.labels.forEach((label, i) => {
    const y = startY + rowH * i + rowH / 2
    out.push(`<rect x="560" y="${y - 11}" width="22" height="22" rx="5" fill="${color(i)}"/>`,
      text(598, y + 7, label, { anchor: 'start', size: 22, fill: palette.ink }),
      text(W - 20, y + 7, `${Math.round((values[i] / total) * 100)}%`, { anchor: 'end', size: 22, fill: palette.ink, weight: 600 }))
  })
  return out.join('')
}
