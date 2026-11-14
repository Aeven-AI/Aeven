---
name: cv
description: Make a CV or résumé with the user in one of Aeven's forty templates, from bold portrait-cover designs (Black, Slate, Fresh) to classic one-page resumes (Harvard, Tang, Minimal Rule), and deliver it as PDF, Word (DOCX) and Pages. Use for any CV, résumé or curriculum vitae request, when the user picked a template on the Resumes page ("…with the Black resume template"), or when they want an existing CV rebuilt in a new design.
---

# CV

A CV is two separate things: the **content** (who the person is, as JSON) and the **template** (how it looks). Every template reads the same fields, so a CV renders in any template; switching the look is changing one field. HTML is the source; PDF, Word and Pages are exported from it.

You build the CV **with** the user, as a short wizard: ask, outline, build, refine. Never invent their facts, employers, dates, numbers or contact details: ask, or leave a clearly marked placeholder.

`$SKILL` below is this skill's directory, from `<skill_resources>`. Work in the user's working directory, one folder per CV, for example `cv/2026/`.

## The wizard

1. **Template.** Use the one the user named; `node "$SKILL/scripts/render.mjs" --list` prints each template's id, name and look. Without a choice, suggest one that fits their field and let them pick.
2. **Read their material.** When the user attached a CV, LinkedIn export, PDF or document, read it first and keep its facts, order and wording; the questions shrink to what it does not say.
3. **Ask once, with `ask_user_question`.** One round of short questions, skipping anything already answered:
   - the role or kind of job they are applying for;
   - a portrait photo for the cover (strongly recommended: the templates are built around a large photo), and optionally a second, wider photo for the About section;
   - length: cover plus one page, or cover plus two to three pages;
   - the CV's language.
4. **Outline, confirmed with `ask_user_question`:** the sections in order with one line each ("Experience · 4 roles, newest first"), offering "Build it" and "Change something".
5. **Write `cv.json`** in the CV folder. The fields are the header comment of `$SKILL/scripts/cv.mjs`; read it before writing. Short form:
   ```json
   { "system": "black", "lang": "en", "name": "Sam Lee", "role": "Product designer",
     "photo": { "src": "photo.jpg", "focus": [60, 30] }, "backdrop": { "src": "wide.jpg" },
     "profile": "…", "contact": [{ "label": "Email", "value": "sam@example.com" }],
     "skills": [{ "name": "UX design", "level": 90, "note": "Expert, 8 years" }],
     "languages": [{ "name": "English", "level": "Native", "value": 100 }],
     "sections": [{ "kind": "timeline", "title": "Experience", "items": [{ "org": "Acme", "title": "Designer", "dates": "2021 – now", "text": "…" }] }],
     "sidebar": [{ "kind": "tags", "title": "Knowledge", "items": ["Figma", "Research"] }],
     "labels": { "about": "About", "profile": "Professional profile", "skills": "Skills", "languages": "Languages" } }
   ```
   Write in the user's language and translate `labels` (also `roleLead`, `skillsIntro`, `languagesIntro`) and `greeting` with it. Keep descriptions to one or two sentences and at most three `points` per role; up to four skills read best as rings. Photo paths are relative to `cv.json`; `focus` is the point of the photo to keep in view, in percent, and `zoom` (1–4) crops into it for designs with a small round photo.
6. **Render and export:**
   ```sh
   node "$SKILL/scripts/render.mjs" cv/2026/cv.json cv/2026
   node "$SKILL/scripts/export.mjs" cv/2026/cv.html cv/2026
   ```
   This writes `cv.html`, `cv.pdf`, `cv.docx`, and `cv.pages` on a Mac with Pages. The first export on a machine without Chrome downloads a headless Chrome once. The Pages step installs the CV's fonts and scripts Pages, which the workspace sandbox refuses: when the exporter prints `.pages skipped`, run the command it prints with the sandbox escalation, giving "convert the CV to Pages and install its fonts" as the reason.
7. **Fix every warning.** The exporter names an entry too tall for a page and a CV longer than four pages (the cover and three). Shorten the text it names, or older entries, and export again until it prints none.
8. **Show it.** Make pictures of the pages (`pdftoppm -r 48 -png cv.pdf p`), look at them yourself (photo crop, line breaks, empty space), then show the user. Ask what to change; each change is an edit to `cv.json` and a re-run, never an edit to the exported files.
9. **Deliver** the PDF, the Word file and (on a Mac) the Pages file.

## Content

- `sections` run in order after About and Skills. `timeline` is for jobs, education, volunteering: `org`, `title`, `dates`, `place`, `text`, `points`, and an optional `icon` (briefcase, plane, compass, pen, code, chart, megaphone, camera, cap, book, laptop, award, globe, heart, flask, building). `list` is for awards, publications, certificates: `title`, `meta` (year), `text`. `text` is one paragraph; `tags` a short checklist.
- `sidebar` sections (`tags`, `text`, `list`) join Skills, as the template's knowledge and extras lists.
- Without a photo, the cover shows the person's initials; say so when they choose to leave it out.
- Content flows onto as many pages as it needs, a whole entry at a time. Only page 1 carries the name block or header; later pages have no header, menu or page number, so the exported pages read as one scroll.

## Exports

- **PDF**: one A4 page per page, printed from the HTML.
- **Word (DOCX)**: each page is a picture of the design under editable text boxes, one per line, in the template's fonts, which are embedded. Small text edits work in Word; layout changes go through `cv.json`.
- **Pages**: Pages converts the Word file after the template's fonts are installed on the Mac (macOS with Pages only). Pages files do not carry fonts: someone opening the file on another Mac needs the template's fonts, all free on Google Fonts.
