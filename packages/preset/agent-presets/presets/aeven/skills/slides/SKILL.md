---
name: slides
description: Make a presentation with the user in one of Aeven's thirty-six slide templates (Dark Pills, Bauhaus Mono, Lush Lux, Startup Pitch, Magazine, Pixel Quest and more), and deliver it as PDF, PowerPoint, Keynote and HTML. Use for any deck, slides, presentation, pitch or keynote request, when the user picked a template on the Slides page ("…with the Lush Lux slide template"), or when they want an existing presentation or document rebuilt in a new design.
---

# Slides

A presentation is two separate things: the **deck** (what each slide says, as JSON) and the **template** (how it looks). Every template draws the same slide kinds with the same fields, so a deck renders in any template and keeps that template's design exactly; switching the look is changing one field. HTML is the source; PDF, PowerPoint, Keynote and pictures are exported from it.

You build the deck **with** the user, as a short wizard: ask, outline, build, refine. Never invent their facts, names or numbers: ask, or leave a clearly marked placeholder.

`$SKILL` below is this skill's directory, from `<skill_resources>`. Work in the user's working directory, one folder per presentation, for example `presentations/series-a/`.

## The wizard

1. **Template.** Use the one the user named; `node "$SKILL/scripts/render.mjs" --list` prints each template's id, name and look. Without a choice, suggest two or three that fit the subject and tone and let them pick.
2. **Ask once, with `ask_user_question`.** One round of short questions, skipping anything the request or an attached file already answers:
   - the goal and the audience: who watches, and what should they do afterwards;
   - length: about 5, 10 or 20 slides;
   - tone: formal, friendly or bold;
   - material: an existing deck, document, notes, numbers or photos to work from (they can attach files).
   When the user attached a presentation, PDF or document, read it first (its text, its structure, its numbers) and keep its story and facts; the questions shrink to what the file does not say.
3. **Outline, confirmed with `ask_user_question`:** one line per slide with its kind ("3 · metrics · Key numbers: revenue, growth, retention"), offering "Build it" and "Change something". Adjust until they choose "Build it".
4. **Write the deck** as `deck.json` in the presentation folder:
   ```json
   { "system": "lush-lux", "title": "Series A", "date": "June 2026", "presenter": "Sam Lee", "lang": "en",
     "slides": [ { "kind": "cover", "title": "Series A", "subtitle": "Why now", "notes": "Open with the ask." } ] }
   ```
   The kinds and their fields are the header comment of `$SKILL/scripts/deck.mjs`; read it before writing. Write in the user's language and voice, keep within each kind's counts (3 points, 3–4 metrics, 3–5 timeline steps…), and put what the speaker should say in `notes`. The user's pictures go in as `{ "src": "photo.jpg", "alt": "…" }` with paths relative to `deck.json`; without `src` the template draws its own placeholder. Use `chart` for numbers that compare or change, and `custom` for anything the other kinds cannot show.
5. **Render and export:**
   ```sh
   node "$SKILL/scripts/render.mjs" presentations/series-a/deck.json presentations/series-a
   node "$SKILL/scripts/export.mjs" presentations/series-a/deck.html presentations/series-a
   ```
   This writes `deck.html`, `deck.pdf`, `deck.pptx`, and `deck.key` on a Mac with Keynote. The first export on a machine without Chrome downloads a headless Chrome once.
6. **Fix every warning.** The exporter names each text that runs past its box or the slide edge, with its slide number. Shorten it, split the slide or move content, and export again until it prints none.
7. **Show it.** Make pictures of the slides (`pdftoppm -r 48 -png deck.pdf p`, or open the HTML in the browser pane), look at them yourself, and show the user the deck. Ask what to change; each change is an edit to `deck.json` and a re-run, never an edit to the exported files.
8. **Deliver** the PDF and the PowerPoint file (and the Keynote file on a Mac), and offer the HTML for presenting with motion and video.

## Charts

A `chart` slide holds `{ title, chart, caption? }`; `chart` is `{ type, labels, series, unit?, stacked? }`. `type` is `column`, `bar`, `line`, `area`, `pie` or `donut`; every series has one number per label; pie and donut use the first series. Charts are drawn in the template's colours and fonts. Use the user's real numbers, and say the point in the title ("Revenue doubled in a year"), not "Revenue chart".

## Custom slides

A `custom` slide holds `{ title?, eyebrow?, html }`: the template draws its own titled frame and places your HTML fragment in the content area, a flex column that fills the rest of the slide. Use it for diagrams, matrices, process flows, pricing grids, comparisons, embedded video or animated builds.

- **The template's tokens, never your own colours or fonts:** `var(--avn-ink)`, `var(--avn-muted)`, `var(--avn-paper)`, `var(--avn-rule)`, `var(--avn-accent-1)` … `var(--avn-accent-4)`, `var(--avn-on-accent)` for text on an accent fill, `var(--font)` and `var(--display-font)`. Match the template's corners and weights by looking at its other slides.
- **Fit the box:** size with flex, grid and percentages so the content fills the area without overflowing; the exporter flags anything clipped. Keep text in real elements, not inside images or SVG `<text>`, so PowerPoint keeps it editable.
- **Scope styles:** inline styles, or one `<style>` block whose selectors all start with a class unique to the slide (`.s7-flow …`). No scripts.
- **Media:** `<img src="chart.png">`, `<video src="demo.mp4" poster="demo.jpg" muted playsinline autoplay loop>`. Local paths are relative to `deck.json` and are embedded into the HTML. A video always needs a `poster`: static formats show it.
- **Motion:** entrance animations and transitions only, written so the element's normal style is its final state (`@keyframes s7-in { from { opacity: 0; transform: translateY(12px) } }`) with `animation-fill-mode: both`. The HTML plays them; PDF, PowerPoint and Keynote show every slide in its final state, with videos on their poster.

## Exports

- **PDF**: one 1280×720 page per slide, printed from the HTML.
- **PowerPoint**: each slide is a picture of the slide with its text lifted out into native, editable text boxes in the template's fonts, plus speaker notes. Layout changes go through `deck.json`, not PowerPoint.
- **Keynote**: Keynote converts the PowerPoint file (macOS with Keynote only).
- **HTML**: the self-contained deck with fonts and pictures embedded; it plays motion and video.
