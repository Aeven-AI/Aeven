/**
 * Schema fixes for the PPTX pptxgenjs writes, so PowerPoint opens it without offering a repair.
 *
 * pptxgenjs 3.12 writes three things PowerPoint or the Open XML SDK validator reject:
 * - `ppt/presentation.xml` lists `p:notesMasterIdLst` after `p:sldIdLst`; the schema puts it
 *   right after `p:sldMasterIdLst`.
 * - the notes master shares the slide master's theme part. PowerPoint gives every master its own
 *   theme, and PowerPoint for the web refuses the file once the notes master is listed where the
 *   schema puts it, so the notes master gets a copy of the theme.
 * - a paragraph whose runs differ in style gets an `a:pPr` before every run; a paragraph holds
 *   one `a:pPr`, as its first child, so every later one is dropped (they repeat the first).
 */

const PPR = /<a:pPr\b[^>]*\/>|<a:pPr\b[^>]*>[\s\S]*?<\/a:pPr>/g

/** One paragraph with only its leading `a:pPr`. */
function singlePPr(paragraph) {
  let first = true
  return paragraph.replace(PPR, (ppr, at) => {
    const keep = first && at === paragraph.indexOf('>') + 1
    first = false
    return keep ? ppr : ''
  })
}

/**
 * Applies the fixes in place.
 * @param {import('jszip')} zip - the opened PPTX package.
 */
export async function fixSchema(zip) {
  const presentationPath = 'ppt/presentation.xml'
  let presentation = await zip.file(presentationPath).async('string')
  const notes = presentation.match(/<p:notesMasterIdLst>[\s\S]*?<\/p:notesMasterIdLst>/)?.[0]
  if (notes) {
    presentation = presentation.replace(notes, '').replace('</p:sldMasterIdLst>', `</p:sldMasterIdLst>${notes}`)
    zip.file(presentationPath, presentation)
  }
  const notesRelsPath = 'ppt/notesMasters/_rels/notesMaster1.xml.rels'
  const notesRels = await zip.file(notesRelsPath)?.async('string')
  const shared = notesRels?.match(/Target="\.\.\/theme\/(theme\d+\.xml)"/)?.[1]
  if (shared) {
    const themes = Object.keys(zip.files).filter((p) => /^ppt\/theme\/theme\d+\.xml$/.test(p))
    const own = `theme${themes.length + 1}.xml`
    zip.file(`ppt/theme/${own}`, await zip.file(`ppt/theme/${shared}`).async('string'))
    zip.file(notesRelsPath, notesRels.replace(`../theme/${shared}`, `../theme/${own}`))
    const typesPath = '[Content_Types].xml'
    const types = await zip.file(typesPath).async('string')
    zip.file(typesPath, types.replace('</Types>', `<Override PartName="/ppt/theme/${own}" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`))
  }
  for (const path of Object.keys(zip.files).filter((p) => /^ppt\/(slides|notesSlides)\/[^/]+\.xml$/.test(p))) {
    const xml = await zip.file(path).async('string')
    const fixed = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, singlePPr)
    if (fixed !== xml) zip.file(path, fixed)
  }
}
