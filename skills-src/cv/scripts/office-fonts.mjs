/**
 * Office font faces for a CV's text in its DOCX.
 *
 * Office names a font by its legacy family (name ID 1) and reaches only four styles of it with
 * the bold and italic flags: Regular, Bold, Italic, Bold Italic. Every other weight of a Google
 * Fonts family is a family of its own, named "<family> <weight name>" ("Oswald Light"), which is
 * the name ID 1 of that weight's static TTF. `officeFace` maps a CSS family and weight to that
 * name and flag, so Word and Pages draw the weight Chrome drew instead of the nearest of 400 and
 * 700. (Shared with the slides exporter's `pptx-fonts.mjs`.)
 */
import { ttfWeights } from './font-files.mjs'

const WEIGHT_NAMES = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 500: 'Medium', 600: 'SemiBold', 800: 'ExtraBold', 900: 'Black' }

/**
 * The Office face for a run.
 * @param {string} family - the CSS font family.
 * @param {number} weight - the CSS font weight.
 * @param {boolean} italic - whether the run is italic.
 * @returns {{ typeface: string, bold: boolean, italic: boolean, family: string, weight: number | null }}
 *   `weight` is the static TTF weight to embed, or null for a family without stored TTF styles
 *   (system fonts), which keeps the plain bold flag.
 */
export function officeFace(family, weight, italic) {
  const styles = ttfWeights(family)
  if (!styles) return { typeface: family, bold: weight >= 600, italic, family, weight: null }
  const style = italic ? 'italic' : 'normal'
  const pool = styles.filter((s) => s.style === style).map((s) => s.weight)
  const weights = pool.length ? pool : styles.map((s) => s.weight)
  const nearest = weights.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), weights[0])
  const named = WEIGHT_NAMES[nearest]
  return {
    typeface: named ? `${family} ${named}` : family,
    bold: nearest === 700,
    italic: italic && pool.length > 0,
    family,
    weight: nearest,
  }
}
