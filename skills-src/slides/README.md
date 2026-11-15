# Aeven Slides

English | [中文](README.zh.md)

Presentation design systems and the generator that fills any of them with a user's own words, at `skills-src/slides` in the aeven repository, next to `skills-src/cv`; `scripts/publish.mjs` writes the copy Aeven ships to `packages/preset/agent-presets/presets/aeven/skills/slides`. HTML is the source; PDF, PPTX, Keynote and gallery pictures are exported from it.

```sh
pnpm install --ignore-workspace                       # its own dependencies, outside the harness workspace
node scripts/render.mjs dark-pills out                 # a system's 20-slide sample deck → out/deck-dark-pills.html
node scripts/render.mjs my-deck.json out               # a user's deck in the system it names
node scripts/export.mjs out out pdf,pptx,key           # every deck-*.html in out/ → PDF, PPTX, Keynote
node scripts/gallery.mjs out/gallery                   # slide pictures for the Aeven Slides gallery
node scripts/publish.mjs                               # ship the skill into this checkout
```

## How it fits together

| Piece | File | Holds |
| --- | --- | --- |
| Content model | `scripts/deck.mjs` | The slide kinds and their fields (including `chart` and `custom`); the guidance deck every template is shown with |
| Charts | `scripts/charts.mjs` | Column, bar, line, area, pie and donut charts as SVG in the system's palette |
| Design system | `systems/<NN-id>/` | `system.json` (fonts, tokens), `layouts.mjs` (one layout per kind), `source.json` (origin, licence) |
| Renderer | `scripts/render.mjs` | Deck + system → self-contained HTML with embedded Google Fonts |
| Exporter | `scripts/export.mjs` | HTML → PDF, PPTX (native shapes and editable text, embedded fonts, speaker notes), Keynote, cover; overflow warnings |
| Office fonts | `scripts/pptx-fonts.mjs`, `scripts/pptx-package.mjs` | Office face names per weight, EOT font embedding, pptxgenjs schema fixes |
| Installed fonts | `scripts/installed-fonts.mjs`, `scripts/font-files.mjs` | TTF lookup and download; installs a deck's fonts for Keynote |
| Gallery | `scripts/gallery.mjs` | 960×540 slide pictures (the first is the card cover) for the app's `slide-templates/` assets |
| Fonts | `scripts/fonts.mjs`, `fonts/` | Google Fonts as WOFF2 with manifests; TTF files are downloaded on demand and stay out of git |
| Rips | `scripts/rip.mjs`, `rips/` (not committed) | Figma Community preview slides, for measuring sources |

Every system draws the same kinds with the same fields, so a deck renders in any system. [SKILL.md](SKILL.md) is what the Aeven agent reads to make a user's deck; the sections below are for adding and maintaining templates.

## Design systems

| Folder | Template | Look | Source |
| --- | --- | --- | --- |
| `01-dark-pills` | Dark Pills | Navy, heavy condensed caps, violet pill labels, "+" rows | Design Presentation Deck (Figma Community, CC BY 4.0) |
| `02-pastel-lineart` | Pastel Play | Lime, lilac and peach fields, Poppins, circle and hexagon crops | Presentation Template with Yuppies Illustrations (Figma Community; recreated, no source assets) |
| `04-agency-pitch` | Agency Pitch | Orange binder cards, condensed caps, stencil numerals, organic blobs | Agency Pitch (Figma, CC BY 4.0) |
| `06-lush-lux` | Lush Lux | Light serif caps on rotating colour fields | Lush Lux (Figma, CC BY 4.0) |
| `07-bauhaus-mono` | Bauhaus Mono | White, black and grey on a 16×9 module grid, geometric shapes | Original (Aeven) |
| `08-paper-pieces` | Paper Pieces | Cut-paper shapes, slanted titles, typewriter text | Paper Pieces (Figma, CC BY 4.0) |
| `05-bold-blobs` | Bold Blobs | Periwinkle, yellow and green panels, heavy condensed caps, drawn 3D spheres, bold arrows | Bold Blobs (Figma Community; recreated) |
| `09-brand-guidelines` | Brand Guidelines | Lime and olive fields, big italic serif, stacked caps label blocks | Brand Guidelines (Figma Community; recreated) |
| `10-clean-zine` | Clean Zine | Mint and brown, condensed serif caps, italic section labels, roman numerals | Clean Zine (Figma Community; recreated) |
| `11-conference-talk` | Conference Talk | Blue, olive and red panels, black slides, grotesque caps with a serif | Conference Talk (Figma Community; recreated) |
| `12-design-portfolio` | Design Portfolio | Green checkerboard bands, mono caps titles, green pills and bars | Design Portfolio (Figma Community; recreated) |
| `13-mid-mod` | Mid Mod | Olive title bands, extra-wide heavy display, sky, pink and yellow blocks | Mid Mod (Figma Community; recreated) |
| `14-startup-pitch` | Startup Pitch | Yellow cover, grey pages, sentence-case headings, outlined pills | Startup Pitch (Figma Community; recreated) |
| `15-research-session` | Research Session | Black and sage, caps titles bottom-left, line stars and sunbursts, typewriter meta | User Research Session (Figma Community; recreated) |
| `16-customer-voice` | Customer Voice | Black report pages, white Inter, pastel rainbow bar and ring | Voice of Customer Insights Report (Figma Community; recreated) |
| `17-project-review` | Project Review | Cream title pages, grey ruled grids, serif caps, black header rule | Project Review (Figma Community; recreated) |
| `18-eigengrau` | Eigengrau | Near-black slate pages, light IBM Plex Sans, dashed hairlines, pastel bars | Eigengrau (Figma Community; recreated) |
| `19-ux-showcase` | UX Showcase | Electric-blue cover with pale geometric shapes, white case-study pages, black footer bar | Finessing UI/UX Design Presentation Template (Figma Community; recreated) |
| `20-marketing-strategy` | Marketing Strategy | Sage and mint, light condensed serif caps, bracketed numbers, italic figures | Marketing Strategy (Figma Community; recreated) |
| `21-mobile-strategy` | Mobile Strategy | Grainy colour-gradient covers, white pages, grey cards | Mobile Product Review (Figma Community; recreated) |
| `22-product-review` | Product Review | Rounded panels inside thick black or cream frames, bold and light title mix | Product Review (Figma Community; recreated) |
| `23-product-roadmap` | Product Roadmap | Black covers, cream ruled pages, big metric rows, mono headers | Product Roadmap (Figma Community; recreated) |
| `24-research-readout` | Research Readout | Pastel pages, vertical mono rail, coloured tag pills | Research Readout (Figma Community; recreated) |
| `25-sales-pitch` | Sales Pitch | Black cover with mint and green title, grey and mint split pages | Sales Pitch (Figma Community; recreated) |
| `26-course-syllabus` | Course Syllabus | Charcoal pages, light serif, a coloured dot per slide | University Course Syllabus (Figma Community; recreated) |
| `27-design-review` | Design Review | Black, white, sage and orange, light caps, serif title bands, ruled grids | Design Review (Figma Community; recreated) |
| `03-blush` | Blush | Cream walls and teal floors, bold Montserrat, abstract shapes in illustration slots | Presentation Template by Blush (Figma Community; recreated, no illustrations) |
| `28-two-tone` | Two Tone | Grey field over an acid-yellow band, huge Inter titles, colour panels with giant numerals | Two Tone (Figma Community; recreated) |
| `29-chuckle` | Chuckle | Purple, orange and lime agency pitch, heavy condensed caps, tilted stickers, notched frames | Digital Agency Pitch Deck (Figma Community; recreated) |
| `30-night-shapes` | Night Shapes | Black slides, royal blue, bold orange and yellow shapes, traffic-light dots | Dark Themed Simple Slide Deck (Figma Community; recreated from its thumbnail) |
| `31-checkerboard` | Checkerboard | Paper and charcoal, checkerboard blocks, lime disc, purple asterisk | Minimalist Simple Slide Deck (Figma Community; recreated from its thumbnail) |
| `32-magazine` | Magazine | Strict black and white, enormous condensed headlines, editorial grids | No.134 Magazine Style Slides (Figma Community; recreated from its thumbnail) |
| `33-pixel-quest` | Pixel Quest | Amber and cream, pixel-art scenes, game-UI panels, pixel type | Presentation Template Kit – Pixel Art Theme (Figma Community; recreated from its thumbnail) |
| `34-moodboard` | Moodboard | White and night pages, sky fields, holographic ribbons, gradient titles | Mood – Moodboard Template (Figma Community; recreated) |
| `35-euclidean` | Euclidean | Warm cream, Source Serif, red accents, split hairline layouts | Euclidean (Figma Community; recreated) |
| `36-folio` | Folio | Black portfolio pages, huge tight titles, coral and blue tiles, violet glows | Folio Presentation Template (Figma Community; recreated from its thumbnail) |

Folders without a `layouts.mjs` are earlier colour-only measurements kept for reference; the renderer skips them and says so.

## Fonts

Google Fonts only, so decks render the same everywhere and the fonts can ship (SIL Open Font License or Apache).

- A system names its families in `type.fonts`: `{ "text": "Inter", "display": "Inter Tight", "extra": ["Space Mono"] }` (`display` and `extra` optional). The renderer refuses a system without `type.fonts.text`.
- Use the Figma source's own font when Google Fonts has it; for a commercial face, pick the closest Google family by build, x-height and width, and record the original in `type.fonts.source`.
- `node scripts/fonts.mjs "<Family>"` stores WOFF2 (embedded in decks) and TTF (for installing or Office embedding) in `fonts/<slug>/`; the renderer stores missing families on first use. Commit the WOFF2 files and manifests; `*.ttf` stays out of git and is downloaded again when needed.
- The PPTX names each weight the way Office does (`Inter Tight ExtraBold`, `Inter` bold) and embeds those TTF styles as EOT, so PowerPoint for Windows and Mac shows them without the font installed. Keynote ignores embedded fonts: before converting, the exporter copies a missing family's TTF styles into `~/Library/Application Support/Aeven/Fonts/` and registers them with CoreText, restarting Keynote when it has no documents open because it reads the font list once.
- Families not stored in `fonts/` (the published skill ships WOFF2 only) are downloaded as TTF from Google Fonts once into `~/.cache/aeven-slides/fonts/`.

## Adding a design system

A system is a folder `systems/<NN-id>/`:

| File | Holds |
| --- | --- |
| `system.json` | `id`, `name`, `label` (the template's display name), `type.fonts`, `palette` {paper, ink, muted, rule, onAccent, accents[3+]}, and any tokens the layouts read |
| `layouts.mjs` | `css(system)` returning the stylesheet, and `slides`: one function per kind, `(data, ctx) => '<section class="slide …">…</section>'`, plus `frame({title, eyebrow}, ctx, body)`, the titled content slide `chart` and `custom` are drawn in |
| `source.json` | `{figmaUrl, title, author, license}`, or `{original: true, …}` for an Aeven design |

`ctx` gives `esc()` (escape every piece of text), `image(img)` (a data URL for the user's picture, or undefined: draw the placeholder), `chart(data)` (the chart SVG), `index`, `total`, `deck` and `system`. The renderer supplies the slide box (1280×720, overflow hidden), print rules, the font faces, `--font` / `--display-font` and the `--avn-*` palette variables, and refuses (with the reason) a system missing a kind, a frame or its palette. `systems/01-dark-pills/layouts.mjs` is the reference.

Rules for a system:
- Every kind, with the same fields as every other system; only the style differs. `chart` and `custom` may come from `frame`.
- Follow the source closely: its palette, type, shapes and meta text, with no invented decorations. Where the source has no slide for a kind, design one that clearly belongs to the family.
- Never copy the source's photos or illustrations; image slots show the user's picture or a placeholder in the system's style.
- Visible text in real text nodes (not `::before`/`::after`, SVG text or images), or the PPTX cannot make it editable.
- Rights: CC BY / CC0 sources can be followed closely, with the author credited in `source.json`; sources that reserve rights are loose reference only.

Check a system by rendering its sample deck, exporting the PDF with `--strict`, and comparing a contact sheet against the source frames in `rips/` (`magick montage p-*.png -tile 5x -geometry +3+3 sheet.png`).

## Ripping Figma sources

`scripts/rip.mjs` reads a Figma Community file's preview slides through the DevTools Chrome (port 9333 by default) into `rips/<name>/` as PNGs plus `meta.json`; `rips/` is not committed. Measure palette and geometry from those PNGs; never ship them.

## Publishing to Aeven

The skill ships inside the Aeven app as the built-in `slides` skill of the `aeven` agent preset, so every session has it without an install. `node scripts/publish.mjs` (or with the path of another aeven checkout) bundles the exporter (`scripts/bundle.mjs` writes `dist/export.mjs` with pptxgenjs, jszip and puppeteer-core inside, so the shipped copy needs no node_modules) and replaces `packages/preset/agent-presets/presets/aeven/skills/slides/` with `SKILL.md`, the scripts, every renderable system and the WOFF2 files of the fonts those systems use. Rebuild the gallery pictures with `scripts/gallery.mjs` and copy them into the app's `apps/web/public/slide-templates/` when a template's look changes.

## Rights

Sources under CC BY 4.0 or CC0 are followed closely and credited in each `source.json`; sources that reserve rights are loose reference only. No source photos, illustrations or ripped frames ship in this repository or in Aeven; image slots show the user's pictures or a placeholder drawn by the system. Fonts are Google Fonts under the SIL Open Font License or Apache 2.0.
