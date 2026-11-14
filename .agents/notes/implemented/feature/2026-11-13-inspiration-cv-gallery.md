# Agent Note: Inspiration Resumes Gallery and the Built-in CV Skill

Status: implemented

English | [中文](2026-11-13-inspiration-cv-gallery.zh.md)

## Problem

People ask Aeven for a CV as often as for a deck, and got an improvised document: a plain Word file or a one-off HTML page, with no design to choose, nothing that kept a look across edits, and no Word or Pages file that looked like the preview. Existing CVs had to be retyped into whatever the agent produced.

## Decision

The Inspiration page gains a third category pill, `Resumes`, at its own start address `/inspiration/resumes` with its own composer placeholder. Its grid shows one portrait A4 card per CV template: the template's full-page portrait cover. A card opens the Slides popup, which became one component for both galleries (`TemplateDialog`, keyed by gallery kind): in its portrait form it shows the page on show as tall as the card allows over a strip of every page, a picker for the reader's current CV (PDF, Word, Pages or text) and a portrait photo, and `Use template`, which attaches them through `addFiles` and writes a request for a CV in that template into the composer. The card markup is one `TemplateCard` for both grids.

The templates and their generator live in the templates repository (`templates/cv`, beside `templates/slides`) and are published into the `aeven` preset as the built-in `cv` skill. A CV is JSON content (name, role, photo, contact, skills, languages, timeline, list, text and tag sections); a design system draws it on A4 pages, and pagination running in the page moves whole entries to the next page and lights each page's sections in the side menu. The first four systems recreate one-page resume sites as stitched A4 pages, each opening on a large portrait: Black and White (the Mee resume site's black-and-green and white-and-yellow variants: a portrait cover, About beside a second photo, skill rings and icon timelines), Slate (Myour: dark slate and mint, the name in a circle rising into the photo, vertical timeline dates) and Fresh (Martyn: white and green, the photo blended into a slanted mint shape, shadow cards and counters). Ten more recreate Figma Community resume files published under CC BY 4.0 (Classic, Glow, Forest, Blobs, Pulse, Portfolio, Sage, Contrast, Magic, Gridfolio); they share their content markup, side/main split and page shells through `scripts/blocks.mjs` and differ in structure and stylesheet. Twenty-six more recreate further CC BY 4.0 Figma Community resume files (Lina's pack, Supa Resume light and dark, Marina, Judit, Mónica, Yoka, Peter Javorkai, Khalil, the Harvard academic resume, the UI/UX kit, Enji Kusnadi, Resumate, BRIX and others) on three archetypes in `scripts/kit.mjs`: sidebar, label column and stacked sections. A system's `sample` in system.json gives its gallery pictures their own person, every one an editorial model portrait from Unsplash. One bundled exporter writes PDF (Chrome print), DOCX and Pages. The DOCX is each page as a picture of the design without its text under one DrawingML text box per line, in the template's embedded fonts; Pages converts that DOCX after the fonts are installed. The gallery pictures (`apps/web/public/cv-templates/`) come from the same repository's `gallery.mjs`.

## Alternatives considered

**A separate `CvDialog`.** It would repeat the slide popup's paging, strip and material picker; the duplication gate rejects that, and both galleries now evolve together.

**A DOCX built from Word tables.** Pages has no nested tables and drops floating pictures inside cells, so the layout collapsed on import, and Word's own reflow would differ from the PDF.

**Framed paragraphs (`w:framePr`) for the text.** Display faces such as Oswald need line boxes taller than tight heading spacing, so neighbouring lines overlap, and Pages drops the text of overlapping frames (checked with a minimal document). Text boxes may overlap.

## Consequences

CVs depend on the templates repository: template changes are made in `templates/cv` and reach Aeven through `scripts/publish.mjs` (about 4.3 MB: the skill, its exporter bundle and eight font families) and `scripts/gallery.mjs` (fourteen sets of page pictures, about 1.1 MB). The sample photos are Unsplash photos under the Unsplash License; the Figma-derived templates credit their source files in each system's source.json, as CC BY 4.0 requires. DOCX pages are pictures with editable text on top, so small wording edits work in Word and Pages while layout changes go through `cv.json`. The Pages export scripts Pages and installs fonts, which the workspace sandbox refuses; the exporter prints the command to run outside it, as the Keynote step of the slides skill does.

## Verification

Every template's sample CV renders to one to four A4 pages with no overflow; the PDFs match the HTML page count, and the Pages files, exported back to PDF, show every line in place over the page pictures (vertical text stays in the picture). The `ui-imagine` specs cover the docs grid, the portrait popup's paging, the material picker's accepted files, the draft with and without attachments, a refused attach, and the slide popup through the shared component; the preset's skill specs accept the new `cv` skill.
