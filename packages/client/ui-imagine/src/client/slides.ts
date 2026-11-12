/**
 * The Slides gallery's presentation templates, in display order, and where their pictures live.
 *
 * Each template is a design system from the slides templates repository (`templates/slides`). Its
 * `scripts/gallery.mjs` writes one folder per template into the web app's `slide-templates/`
 * assets: `slide-01.webp` … one 960×540 picture per slide of the template's sample deck; the
 * first is the card's cover. An entry here needs that folder to ship.
 */

/** One presentation template on the Slides card grid. */
export interface SlideTemplate {
  /** The design system's id, which is also its asset folder and its locale key. */
  readonly id: string
  /** How many slide pictures its folder holds. */
  readonly slides: number
}

/** The templates in card order. */
export const SLIDE_TEMPLATES = [
  { id: 'dark-pills', slides: 20 },
  { id: 'bauhaus-mono', slides: 20 },
  { id: 'agency-pitch', slides: 20 },
  { id: 'lush-lux', slides: 20 },
  { id: 'startup-pitch', slides: 20 },
  { id: 'mid-mod', slides: 20 },
  { id: 'pastel-lineart', slides: 20 },
  { id: 'paper-pieces', slides: 20 },
  { id: 'bold-blobs', slides: 20 },
  { id: 'brand-guidelines', slides: 20 },
  { id: 'clean-zine', slides: 20 },
  { id: 'conference-talk', slides: 20 },
  { id: 'design-portfolio', slides: 20 },
  { id: 'research-session', slides: 20 },
  { id: 'customer-voice', slides: 20 },
  { id: 'project-review', slides: 20 },
  { id: 'ux-showcase', slides: 20 },
  { id: 'marketing-strategy', slides: 20 },
  { id: 'mobile-strategy', slides: 20 },
  { id: 'sales-pitch', slides: 20 },
  { id: 'course-syllabus', slides: 20 },
  { id: 'product-roadmap', slides: 20 },
  { id: 'research-readout', slides: 20 },
  { id: 'eigengrau', slides: 20 },
  { id: 'product-review', slides: 20 },
  { id: 'design-review', slides: 20 },
  { id: 'two-tone', slides: 20 },
  { id: 'chuckle', slides: 20 },
  { id: 'night-shapes', slides: 20 },
  { id: 'checkerboard', slides: 20 },
  { id: 'magazine', slides: 20 },
  { id: 'pixel-quest', slides: 20 },
  { id: 'moodboard', slides: 20 },
  { id: 'euclidean', slides: 20 },
  { id: 'blush', slides: 20 },
  { id: 'folio', slides: 20 },
] as const satisfies readonly SlideTemplate[]

/** A template id the gallery ships. */
export type SlideTemplateId = typeof SLIDE_TEMPLATES[number]['id']

/**
 * The URL of one of a template's pictures.
 * @param id - the template.
 * @param file - a `slide-NN.webp` name, from {@link slideFile}.
 * @returns the absolute URL under the web app's `slide-templates/` assets.
 */
export function slideAssetUrl(id: SlideTemplateId, file: string): string {
  return new URL(`slide-templates/${id}/${file}`, document.baseURI).href
}

/**
 * The file name of a template's slide picture.
 * @param index - the slide's zero-based position.
 * @returns `slide-01.webp` for the first slide.
 */
export function slideFile(index: number): string {
  return `slide-${String(index + 1).padStart(2, '0')}.webp`
}
