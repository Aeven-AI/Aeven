/**
 * The DOCX export, for any design system: each page is a picture of the rendered page with its
 * text hidden (photos, panels, rules, rings, icons) floating behind the page, and every line of
 * text on top as real, editable text in a text box of its own, at the position, font, size,
 * weight, colour and letter spacing Chrome laid it out with. Lines break where Chrome broke them,
 * so Word and Pages cannot reflow the design; content changes go through cv.json and a new export.
 *
 * Text boxes, not framed paragraphs: display faces such as Oswald need a line box taller than the
 * tight line spacing of headings, so neighbouring lines overlap, and Pages drops the text of
 * framed paragraphs that overlap. Text boxes may overlap freely. The `docx` library writes the
 * page pictures, page breaks and fonts with a placeholder paragraph per page; `fillTextBoxes`
 * replaces each placeholder with that page's text boxes (DrawingML `wps:wsp` shapes).
 *
 * `extractAndHideText` runs in the page.
 */

/**
 * Runs in the page: reads every line of text on every page, then makes the text transparent so a
 * screenshot of the page carries everything but the words.
 * @returns {{ width: number, height: number, lines: object[] }[]} per page, its size in CSS px and
 *   its lines: `{ x, y, w, h, runs: [{ text, font, size, weight, italic, color, spacing }] }`, the
 *   box being the line's glyph box in CSS px from the page's top left.
 */
export function extractAndHideText() {
  const blockOf = (el) => {
    for (let e = el; e; e = e.parentElement) {
      const d = getComputedStyle(e).display
      if (d !== 'inline' && d !== 'contents') return e
    }
    return el
  }
  const hex = (css) => {
    const m = css.match(/rgba?\(([^)]+)\)/)
    if (!m) return '000000'
    return m[1].split(/[ ,/]+/).filter(Boolean).slice(0, 3).map((v) => Math.round(Number(v)).toString(16).padStart(2, '0')).join('').toUpperCase()
  }
  const caseOf = (text, mode) => mode === 'uppercase' ? text.toUpperCase() : mode === 'lowercase' ? text.toLowerCase() : text
  const hide = []
  const range = document.createRange()
  const out = [...document.querySelectorAll('section.page')].map((page) => {
    const pr = page.getBoundingClientRect()
    const lines = []
    let line = null
    let prevRight = 0
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || parent.closest('svg, script, style, template') || !node.data.trim()) continue
      const s = getComputedStyle(parent)
      if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) < 0.02) continue
      // Text set vertically (a timeline's dates running up the page) stays in the page picture.
      if (/^(vertical|sideways)/.test(s.writingMode)) continue
      const block = blockOf(parent)
      const style = {
        font: s.fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, ''),
        size: parseFloat(s.fontSize),
        weight: Number(s.fontWeight),
        italic: s.fontStyle === 'italic',
        color: hex(s.color),
        spacing: parseFloat(s.letterSpacing) || 0,
      }
      // A hyphenated word may break across lines at its hyphen, so each part is its own word.
      const words = /[^\s-]+-?|-/g
      for (let m = words.exec(node.data); m; m = words.exec(node.data)) {
        range.setStart(node, m.index)
        range.setEnd(node, m.index + m[0].length)
        const r = [...range.getClientRects()].find((x) => x.width > 0)
        if (!r) continue
        const sameLine = line && line.block === block && Math.abs(r.top - line.top) < r.height * 0.5 && r.left >= prevRight - 1
        if (!sameLine) {
          line = { block, top: r.top, left: r.left, right: r.right, bottom: r.bottom, runs: [] }
          lines.push(line)
        }
        const text = caseOf(m[0], s.textTransform)
        const last = line.runs[line.runs.length - 1]
        const space = sameLine && r.left - prevRight > style.size * 0.12 ? ' ' : ''
        if (last && last.font === style.font && last.size === style.size && last.weight === style.weight && last.color === style.color && last.spacing === style.spacing && last.italic === style.italic) last.text += space + text
        else line.runs.push({ ...style, text: (space && last ? ' ' : '') + text })
        line.left = Math.min(line.left, r.left)
        line.right = Math.max(line.right, r.right)
        line.top = Math.min(line.top, r.top)
        line.bottom = Math.max(line.bottom, r.bottom)
        prevRight = r.right
      }
      hide.push(node)
    }
    return {
      width: pr.width,
      height: pr.height,
      lines: lines.map((l) => ({ x: l.left - pr.left, y: l.top - pr.top, w: l.right - l.left, h: l.bottom - l.top, runs: l.runs })),
    }
  })
  for (const node of hide) {
    const span = document.createElement('span')
    span.style.cssText = 'color:transparent!important;-webkit-text-fill-color:transparent!important'
    node.parentNode.insertBefore(span, node)
    span.appendChild(node)
  }
  return out
}

/** The placeholder paragraph text for page `index`, which {@link fillTextBoxes} replaces. */
const placeholder = (index) => `@@CV-TEXT-${index}@@`

/**
 * The Document options for the pages: each page's picture behind it and a placeholder paragraph.
 * @param {object[]} pages - from {@link extractAndHideText}, each with `background`, a JPEG of the
 *   page without its text.
 * @param {object} lib - the `docx` module.
 * @param {{ title: string, creator: string }} meta - document properties.
 * @returns {object} options for `new Document(…)`; the caller adds the embedded fonts.
 */
export function documentOptions(pages, lib, meta) {
  const { Paragraph, TextRun, ImageRun, PageBreak, HorizontalPositionRelativeFrom, VerticalPositionRelativeFrom, TextWrappingType } = lib
  const tight = { before: 0, after: 0, line: 20, lineRule: 'exact' }
  const children = []
  pages.forEach((page, index) => {
    children.push(new Paragraph({
      children: [
        ...(index > 0 ? [new PageBreak()] : []),
        new ImageRun({
          type: 'jpg', data: page.background, transformation: { width: page.width, height: page.height },
          floating: {
            horizontalPosition: { relative: HorizontalPositionRelativeFrom.PAGE, offset: 0 },
            verticalPosition: { relative: VerticalPositionRelativeFrom.PAGE, offset: 0 },
            behindDocument: true, allowOverlap: true, wrap: { type: TextWrappingType.NONE },
          },
        }),
      ],
      spacing: tight,
    }))
    children.push(new Paragraph({ children: [new TextRun({ text: placeholder(index), size: 2 })], spacing: tight }))
  })
  return {
    title: meta.title,
    creator: meta.creator,
    sections: [{
      properties: { page: { size: { width: px2tw(pages[0].width), height: px2tw(pages[0].height) }, margin: { top: 0, right: 0, bottom: 0, left: 0, header: 0, footer: 0 } } },
      children,
    }],
  }
}

const px2tw = (px) => Math.round(px * 15) // CSS px → twentieths of a point
const px2emu = (px) => Math.round(px * 9525)
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * Replaces each page's placeholder paragraph in `word/document.xml` with the page's text boxes.
 * @param {string} documentXml - the document part the `docx` library wrote.
 * @param {object[]} pages - from {@link extractAndHideText}.
 * @param {(family: string, weight: number, italic: boolean) => { font: string, bold: boolean, italic: boolean }} face
 *   - the Office face for a CSS family and weight.
 * @returns {string} the document part with text boxes.
 */
export function fillTextBoxes(documentXml, pages, face) {
  let id = 5000
  return pages.reduce((doc, page, index) => {
    const boxes = page.lines.map((line) => {
      id += 1
      const w = line.w + Math.max(8, line.w * 0.1)
      const runs = line.runs.map((r) => {
        const f = face(r.font, r.weight, r.italic)
        const fonts = `<w:rFonts w:ascii="${xml(f.font)}" w:hAnsi="${xml(f.font)}" w:cs="${xml(f.font)}" w:eastAsia="${xml(f.font)}"/>`
        const spacing = r.spacing ? `<w:spacing w:val="${Math.round(r.spacing * 15)}"/>` : ''
        const size = Math.round(r.size * 1.5)
        return `<w:r><w:rPr>${fonts}${f.bold ? '<w:b/>' : ''}${f.italic ? '<w:i/>' : ''}<w:color w:val="${r.color}"/>${spacing}<w:sz w:val="${size}"/><w:szCs w:val="${size}"/></w:rPr><w:t xml:space="preserve">${xml(r.text)}</w:t></w:r>`
      }).join('')
      const para = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${px2tw(line.h)}" w:lineRule="exact"/></w:pPr>${runs}</w:p>`
      return `<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="${id}" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>${px2emu(line.x)}</wp:posOffset></wp:positionH><wp:positionV relativeFrom="page"><wp:posOffset>${px2emu(line.y)}</wp:posOffset></wp:positionV><wp:extent cx="${px2emu(w)}" cy="${px2emu(line.h)}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:wrapNone/><wp:docPr id="${id}" name="Text ${id}"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr txBox="1"/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px2emu(w)}" cy="${px2emu(line.h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln><a:noFill/></a:ln></wps:spPr><wps:txbx><w:txbxContent>${para}</w:txbxContent></wps:txbx><wps:bodyPr rot="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="t" anchorCtr="0" upright="1"><a:noAutofit/></wps:bodyPr></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`
    }).join('')
    const pattern = new RegExp(`<w:p>(?:(?!<w:p>).)*?${placeholder(index)}.*?</w:p>`, 's')
    if (!pattern.test(doc)) throw new Error(`docx: no placeholder for page ${index + 1}`)
    return doc.replace(pattern, `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr>${boxes}</w:p>`)
  }, documentXml)
}
