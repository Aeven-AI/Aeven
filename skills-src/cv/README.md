# Aeven CV

English | [中文](README.zh.md)

CV design systems and the generator that fills any of them with a person's own content, at `skills-src/cv` in the aeven repository, next to `skills-src/slides`; `scripts/publish.mjs` writes the copy Aeven ships to `packages/preset/agent-presets/presets/aeven/skills/cv`. HTML is the source; PDF, DOCX and Pages are exported from it.

```sh
pnpm install --ignore-workspace                # its own dependencies, outside the harness workspace
node scripts/render.mjs black out              # a system's sample CV → out/cv-black.html
node scripts/render.mjs my-cv.json out          # a person's CV in the system it names → out/my-cv.html
node scripts/export.mjs out/cv-black.html out   # → PDF, DOCX, Pages (pdf,docx,pages to choose)
node scripts/gallery.mjs out/gallery            # page pictures for the Aeven Resumes gallery
node scripts/publish.mjs                        # ship the skill into this checkout
```

## How it fits together

| Piece | File | Holds |
| --- | --- | --- |
| Shared blocks | `scripts/blocks.mjs` | Content markup (entries, lists, skills, languages, contact), the side/main split and page shells that systems 05–40 build on |
| Archetypes | `scripts/kit.mjs` | Sidebar, label-column and stacked resume layouts with header pieces, used by systems 15–40 |
| Content model | `scripts/cv.mjs` | The CV fields and section kinds, validation, the gallery's sample CV |
| Icons | `scripts/icons.mjs` | Line icons for timeline entries |
| Design system | `systems/<NN-id>/` | `system.json` (fonts, palette), `layouts.mjs` (stylesheet and pages), `source.json` (origin) |
| Renderer | `scripts/render.mjs` | CV + system → self-contained A4 HTML with embedded fonts and photos; pagination runs in the page |
| Exporter | `scripts/export.mjs` | HTML → PDF (Chrome), DOCX (`scripts/docx.mjs`), Pages; page-count and overflow warnings |
| Office fonts | `scripts/office-fonts.mjs` | Office face names per weight ("Oswald Light") |
| Installed fonts | `scripts/installed-fonts.mjs`, `scripts/font-files.mjs` | TTF lookup and download; installs a CV's fonts for Pages |
| Gallery | `scripts/gallery.mjs` | 794×1123 page pictures (the first is the card cover) for the app's `cv-templates/` assets |
| Samples | `samples/` | The sample CV's photos |
| Fonts | `scripts/fonts.mjs`, `fonts/` | Google Fonts as WOFF2 with manifests; TTF files are downloaded on demand and stay out of git |

[SKILL.md](SKILL.md) is what the Aeven agent reads to make a person's CV.

## Design systems

| Folder | Template | Look | Source |
| --- | --- | --- | --- |
| `01-black` | Black | Black and charcoal bands, green name block, full-page portrait cover, Oswald caps, skill rings, icon timeline | Mee Resume, Black + Green (ThemeZaa); recreated in A4 portrait from its 860px-wide demo |
| `02-white` | White | The Black layout in white, pale grey and yellow with a black side column | Mee Resume, White + Yellow (ThemeZaa); recreated |
| `03-slate` | Slate | Dark slate and mint, heavy Poppins titles, photo cover with the name in a rising circle, vertical timeline dates, skill bars, dot-rated languages | Myour, index-3 (bslthemes); recreated in A4 portrait from its 860px-wide demo |
| `04-fresh` | Fresh | White and fresh green, Montserrat titles, hero with the photo blended into a slanted mint shape, framed About photo, shadow cards, counters, chips | Martyn (bestwebcreator); recreated in A4 portrait from its 860px-wide demo |
| `05-classic` | Classic | White A4, black top rule, bold name, round photo on a yellow ring, quiet two columns | CV / Resume (Alexis Riols), Figma Community, CC BY 4.0; recreated |
| `06-glow` | Glow | Warm paper with a grainy orange glow, wide Unbounded headline, numbered section rules | CV Resume Template (Katerina Pavlova), Figma Community, CC BY 4.0; recreated |
| `07-forest` | Forest | Deep green side column with a round photo and white skill bars | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `08-blobs` | Blobs | Pink, green and cyan blobs, the photo inside a blob, big caps name | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `09-pulse` | Pulse | Blue-to-magenta frame, glass side card, label tabs, skill rings | CV/Resume (Jay Patel), Figma Community, CC BY 4.0; recreated |
| `10-portfolio` | Portfolio | Charcoal Poppins pages, offset photo frame, gradient rings and cards | Personal Portfolio / CV (UXM), Figma Community, CC BY 4.0; recreated |
| `11-sage` | Sage | Sage header band with a serif hello and a black-and-white portrait | Product & UX Designer Resume (Pixelzudio), Figma Community, CC BY 4.0; recreated |
| `12-contrast` | Contrast | Grey paper, B/W portrait on a yellow block, spaced caps name, yellow timeline | CV/Resume (Israel Betolaza), Figma Community, CC BY 4.0; recreated |
| `13-magic` | Magic | Near-black page under an aurora, gradient-ringed avatar, compact sections | Magic Resume (Once UI), Figma Community, CC BY 4.0; recreated |
| `14-gridfolio` | Gridfolio | Cream page, white rounded profile card with a large photo, orange titles | Designer Resume – Gridfolio (Matteo Tiscia), Figma Community, CC BY 4.0; recreated |
| `15-tang` | Tang | Huge caps name over a hairline, underlined caps headings, black skill bars, no photo | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `16-sunbeam` | Sunbeam | White page, photo and name top left, a sunny yellow-to-blue gradient side column on the right | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `17-noirband` | Noir Band | A black header band with a centred round photo and contact row over two crisp columns | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `18-confetti` | Confetti | Centred round photo in a scatter of pastel confetti, numbered section labels and soft grey chips | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `19-mintmist` | Mint Mist | A mint and lemon glow behind a large intro line, label column layout, photo top left | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `20-serifbold` | Serif Bold | A huge black serif name beside a round photo, small caps labels in a quiet left column | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `21-bluewash` | Bluewash | Royal blue name, navy and peach paper shapes in the corners, a clean right side column | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `22-minimalrule` | Minimal Rule | Square photo and name over hairlines, spaced caps labels, everything on a strict grid | Resume / CV Templates (Lina), Figma Community, CC BY 4.0; recreated |
| `23-supa` | Supa | Modern card resume: big rounded photo in a pale side column, colour-coded contact, entries as cards with icon tiles | Supa Resume - Light & Dark (Angelo Libero), Figma Community, CC BY 4.0; recreated |
| `24-supa-dark` | Supa Dark | The Supa card resume on deep night navy with violet accents | Supa Resume - Light & Dark (Angelo Libero), Figma Community, CC BY 4.0; recreated |
| `25-marina` | Marina | Electric blue edge with pink and yellow diamonds, bold Space Grotesk, skills on pink grid paper | Minimal CV/Resume template 1.0 (Marina), Figma Community, CC BY 4.0; recreated |
| `26-judit` | Judit | Warm ivory page, a serif name and coral accents, round photo and tidy hairline sections | CV / Resume Template (Judit Salvadó), Figma Community, CC BY 4.0; recreated |
| `27-monica` | Mónica | A sky blue top edge, name with a blue subtitle, round photo right, two columns with spaced caps labels | CV / Resume Figma Template (Community) (Mónica Fidalgo), Figma Community, CC BY 4.0; recreated |
| `28-sunny` | Sunny | A bold yellow header with a big hello, the photo in an arch, pink chips and playful type | Resume CV Templates (Yoka leis), Figma Community, CC BY 4.0; recreated |
| `29-javorkai` | Javorkai | Swiss A4: a large name, a square photo, section labels running up the margin, dates in their own column | Resume & Cover Letter template (Peter Javorkai), Figma Community, CC BY 4.0; recreated |
| `30-khalil` | Khalil | Charcoal page with yellow accents, a ringed round photo and a soft side card | Modern & Clean Resume | CV Templates (Khalil Boukhelifa), Figma Community, CC BY 4.0; recreated |
| `31-ember` | Ember | The Khalil layout on sunny yellow with a white side card and black type | Modern & Clean Resume | CV Templates (Khalil Boukhelifa), Figma Community, CC BY 4.0; recreated |
| `32-harvard` | Harvard | The classic academic resume: centred serif name, full-width rules, places and dates aligned right, no photo | Harvard Academic Resume / CV Template (Figma Community), Figma Community, CC BY 4.0; recreated |
| `33-kit` | Kit | A white rounded sheet on a soft lavender frame, small rounded photo, violet role and label column | UI/UX Designer Resume / CV Kit (Figma Community), Figma Community, CC BY 4.0; recreated |
| `34-kit-dark` | Kit Dark | The Kit sheet in dark mode: charcoal card on an indigo frame | UI/UX Designer Resume / CV Kit (Figma Community), Figma Community, CC BY 4.0; recreated |
| `35-six` | Six | A pale blue side column and header, square photo, pink section titles in Work Sans | 6 Free Resume Templates (Figma Community), Figma Community, CC BY 4.0; recreated |
| `36-pills` | Pills | Every section a white card on light grey, with a colourful pill title; a friendly modern layout | +60 Resume/CV Templates (Figma Community), Figma Community, CC BY 4.0; recreated |
| `37-aurora` | Aurora | A pink-to-lilac gradient header with a round photo and link chips, then a calm label column | Resume (Enji Kusnadi), Figma Community, CC BY 4.0; recreated |
| `38-aurora-dark` | Aurora Dark | The Aurora layout at night: navy page under a magenta and violet glow | Resume (Enji Kusnadi), Figma Community, CC BY 4.0; recreated |
| `39-resumate` | Resumate | White page with a black diagonal corner and a soft pink glow, blue name and section titles | Resumate - FREE Resume/CV Template Pack (Reyhan Tamang), Figma Community, CC BY 4.0; recreated |
| `40-brix` | Brix | Clean Manrope resume: rounded photo, violet role, contact chips, dates in a left column and violet section bars | CV / Resume Templates | BRIX Templates (BRIX Templates), Figma Community, CC BY 4.0; recreated |

A system's `layouts.mjs` exports `css(system)` and `pages(cv, ctx)`, returning the opening pages with every block and an empty continuation page. Blocks carry `data-block`; the renderer's pagination moves whole blocks to the next page while a column overflows, keeps `data-keep` headings with their first entry, and gives a column's empty tail its last block's `data-band`. Only page 1 carries a name block or header; no page carries a menu or page number, because the exports read as one scroll. Palette colours reach the stylesheet as `--c-<name>`; White reuses Black's layouts with its own palette. A system's `sample` in system.json overrides fields of the shared sample CV, so each template's gallery shows its own person (`sampleFor` in `cv.mjs`).

## Exports

- **PDF**: Chrome prints the paginated HTML, A4, backgrounds included.
- **DOCX**: every page is a JPEG of the page with its text hidden, floating behind the page, under one DrawingML text box per line at the position, font, size, weight, colour and letter spacing Chrome used. The fonts are embedded. Text boxes rather than framed paragraphs: display faces need line boxes taller than tight heading spacing, so lines overlap, and Pages drops the text of overlapping framed paragraphs.
- **Pages**: the CV's fonts are installed and Pages opens the DOCX and saves it (macOS with Pages); a workspace sandbox refuses both, and the exporter prints the command to run outside it.

## Sample photos

`samples/model-<id>.jpg` are editorial portraits from Unsplash under the Unsplash License (the id is the Unsplash photo id); each system's `sample` in system.json picks one.
