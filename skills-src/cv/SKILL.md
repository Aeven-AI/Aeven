---
name: cv
description: Make a CV or résumé with the user in one of Aeven's forty templates, from bold portrait-cover designs (Black, Slate, Fresh) to classic one-page resumes (Harvard, Tang, Minimal Rule), and deliver it as PDF, Word (DOCX) and Pages. Use for any CV, résumé or curriculum vitae request, when the user picked a template on the Resumes page ("…with the Black resume template"), or when they want an existing CV rebuilt in a new design.
---

# CV

A CV is **content** (who the person is, as JSON) plus a **template** (how it looks). Every template reads the same fields, so switching the look is changing one field. HTML is the source; PDF, Word and Pages are exported from it.

You **guide** the user through a short, fixed path: questions, outline, build, review. They always know which step they are on: open each step with one short line ("Reading your CV…", "Here's the plan for your pages", "Building the pages now"). Never invent their facts, employers, dates, numbers or contact details: ask, or leave a clearly marked placeholder.

Everything you need is in this file, the header comment of `$SKILL/scripts/cv.mjs`, and what the scripts print. Do not read the skill's other scripts or the templates' `layouts.mjs`, measure pages, or write helper scripts: when the output does not tell you what to do, ask the user.

`$SKILL` below is this skill's directory, from `<skill_resources>`. Unless the user names a place, work in the Aeven folder your context names, else the working directory, one folder per CV, e.g. `CVs/2026/`, and put nothing in it but `cv.json`, the person's pictures and the exports.

## The path

1. **Template.** Use the one the user named; `node "$SKILL/scripts/render.mjs" --list` prints each template's id, name and look. Without a choice, suggest two or three that fit their field and let them pick.
2. **Read their material.** When the user attached a CV, LinkedIn export, PDF or document, read it first and keep its facts, order and wording. Check which files actually came: a Resumes-page request can mention a photo that is not attached.
3. **One round of questions, with `ask_user_question`,** skipping anything the material already answers:
   - the photo, when the template shows one (its look in `--list` names a portrait or photo) and none is attached: "I'll attach one" or "Build without a photo" (the cover then shows their initials);
   - length: cover plus one page, or cover plus two to three pages (one page for the one-page designs);
   - the role or kind of job they are applying for;
   - the CV's language, only when the material and the conversation leave it open.
4. **Outline, confirmed with `ask_user_question`, always, also when rebuilding an attached CV:** the sections in order with one line each ("Experience · 3 roles, newest first"), and any decision the user should know about (what you shortened or left out, how skill levels were set). Offer "Build it" and "Change something"; adjust until they choose "Build it".
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
   Write in the user's language and translate `labels` (also `roleLead`, `skillsIntro`, `languagesIntro`) and `greeting` with it. Keep descriptions to one or two sentences and at most three `points` per role. Photo paths are relative to `cv.json`; `focus` is the point of the photo to keep in view, in percent, and `zoom` (1–4) crops into it for designs with a small round photo.
6. **Build:**
   ```sh
   node "$SKILL/scripts/render.mjs" cv/2026/cv.json cv/2026
   node "$SKILL/scripts/export.mjs" cv/2026/cv.html cv/2026
   ```
   Run the export with the bash tool's `output_files` set to `cv.pdf`, `cv.docx` and `cv.pages` in the CV folder and `timeoutMs: 300000`, on every rebuild too: those files are what the reply ends with. It writes `cv.html`, `cv.pdf`, `cv.docx`, and `cv.pages` on a Mac with Pages; the first export without Chrome downloads one. The workspace sandbox refuses the Pages step: when the exporter prints `.pages skipped`, run exactly the command it prints, nothing added, with the sandbox escalation, `output_files` set to the `.pages` file, `timeoutMs: 300000`, and "convert the CV to Pages and install its fonts" as the reason. When it prints `Pages file not made`, or the step fails or times out, hand over the PDF and Word files with the exporter's message; never look for the Pages app yourself.
7. **Follow the page report.** The exporter prints each page's sections and how full it is, then `layout ok` or warnings naming the `cv.json` change: an entry taller than its page, more than four pages, or a nearly empty last page (lines to free, and which section can become a compact `list`). Make the first change it names that keeps the person's content, build again, and stop at `layout ok`. When two rounds do not get there, or the only changes left cut content, ask the user which way to go with the report's options.
8. **Look before you show.** The exporter prints `previews:` and a picture of every page. Check each for the photo crop, awkward line breaks and empty areas the report cannot see (a bare photo panel). Fix what you can in `cv.json` and build again.
9. **Hand it over, and end on the files.** The reply is short: one line on what you built (template, number of pages); at most three decisions for the user to confirm; the files, each in inline code by its full path (`/…/cv/2026/cv.pdf`, `cv.docx`, `cv.pages`); and one line naming two or three fitting changes (add the photo, fewer pages, another template, rework the profile). Then end the turn on the files, with no question. Each change the user asks for is an edit to `cv.json` and a rebuild, never an edit to the exported files.

## Content

- `sections` run in order after About and Skills. `timeline` is for jobs, education, volunteering: `org`, `title`, `dates`, `place`, `text`, `points`, and an optional `icon` (briefcase, plane, compass, pen, code, chart, megaphone, camera, cap, book, laptop, award, globe, heart, flask, building). `list` is the compact form, one line per entry: awards, publications, certificates, and education when space is short: `title`, `meta` (year or school and year), `text`. `text` is one paragraph; `tags` a short checklist.
- `sidebar` sections (`tags`, `text`, `list`) join Skills, as the template's knowledge and extras lists.
- **Skill levels** draw as rings or bars, so they are numbers the user stands behind. Use the person's own number; otherwise map their word: expert 90, advanced 75, intermediate 60, basic 40, and keep the word in `note`. A skill with neither goes into a `tags` section, not a ring. Up to four skills read best as rings.
- Content flows onto as many pages as it needs, a whole entry at a time; only page 1 carries the name block or header.

## Exports

- **PDF**: one A4 page per page, printed from the HTML.
- **Word (DOCX)**: each page is a picture of the design under editable text boxes, one per line, in the template's embedded fonts. Small text edits work in Word; layout changes go through `cv.json`.
- **Pages**: converted from the Word file on a Mac with Pages. Pages files carry no fonts: another Mac needs the template's fonts, all free on Google Fonts.
