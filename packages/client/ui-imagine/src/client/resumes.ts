/**
 * The Resumes gallery's templates, in display order, and where their pictures live.
 *
 * Each template is a design system from the CV templates repository (`templates/cv`). Its
 * `scripts/gallery.mjs` writes one folder per template into the web app's `cv-templates/` assets:
 * `page-01.webp` … one 794×1123 picture per A4 page of the template's sample CV; the first, the
 * full-page portrait cover, is the card's picture. An entry here needs that folder to ship.
 */

/** One resume template on the Resumes card grid. */
export interface ResumeTemplate {
  /** The design system's id, which is also its asset folder and its locale key. */
  readonly id: string
  /** How many page pictures its folder holds. */
  readonly pages: number
}

/** The templates in card order. */
export const RESUME_TEMPLATES = [
  { id: 'black', pages: 4 },
  { id: 'white', pages: 4 },
  { id: 'slate', pages: 4 },
  { id: 'fresh', pages: 4 },
  { id: 'classic', pages: 1 },
  { id: 'glow', pages: 1 },
  { id: 'forest', pages: 1 },
  { id: 'blobs', pages: 1 },
  { id: 'pulse', pages: 1 },
  { id: 'portfolio', pages: 2 },
  { id: 'sage', pages: 1 },
  { id: 'contrast', pages: 1 },
  { id: 'magic', pages: 2 },
  { id: 'gridfolio', pages: 1 },
  { id: 'tang', pages: 1 },
  { id: 'sunbeam', pages: 1 },
  { id: 'noirband', pages: 1 },
  { id: 'confetti', pages: 1 },
  { id: 'mintmist', pages: 1 },
  { id: 'serifbold', pages: 1 },
  { id: 'bluewash', pages: 1 },
  { id: 'minimalrule', pages: 1 },
  { id: 'supa', pages: 1 },
  { id: 'supa-dark', pages: 1 },
  { id: 'marina', pages: 1 },
  { id: 'judit', pages: 1 },
  { id: 'monica', pages: 1 },
  { id: 'sunny', pages: 1 },
  { id: 'javorkai', pages: 1 },
  { id: 'khalil', pages: 1 },
  { id: 'ember', pages: 1 },
  { id: 'harvard', pages: 1 },
  { id: 'kit', pages: 1 },
  { id: 'kit-dark', pages: 1 },
  { id: 'six', pages: 1 },
  { id: 'pills', pages: 2 },
  { id: 'aurora', pages: 1 },
  { id: 'aurora-dark', pages: 1 },
  { id: 'resumate', pages: 1 },
  { id: 'brix', pages: 1 },
] as const satisfies readonly ResumeTemplate[]

/** A template id the gallery ships. */
export type ResumeTemplateId = typeof RESUME_TEMPLATES[number]['id']

/**
 * The URL of one of a template's page pictures.
 * @param id - the template.
 * @param index - the page's zero-based position.
 * @returns the absolute URL of `page-NN.webp` under the web app's `cv-templates/` assets.
 */
export function resumeAssetUrl(id: ResumeTemplateId, index: number): string {
  return new URL(`cv-templates/${id}/page-${String(index + 1).padStart(2, '0')}.webp`, document.baseURI).href
}
