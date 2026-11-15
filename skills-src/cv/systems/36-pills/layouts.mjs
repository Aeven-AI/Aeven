/**
 * Pills: Every section a white card on light grey, with a colourful pill title; a friendly modern layout. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.card { padding: 18px 20px; border-radius: 16px; background: var(--c-card); }
.head { display: grid; grid-template-columns: 70px 1fr; gap: 16px; align-items: center; margin: 32px 40px 0; }
.head .crow { grid-column: 1 / -1; padding-top: 12px; border-top: 1px solid var(--c-rule); font-size: 9.5px; }
.ph { width: 70px; height: 70px; border-radius: 50%; }
.name { font-size: 22px; font-weight: 700; color: var(--c-ink); }
.role { font-size: 11px; color: var(--c-muted); }
.main .flow { padding: 0 40px 36px; }
.page-cont .main .flow { padding-top: 36px; }
.flow > .card { margin-top: 12px; }
.flow > .card:first-child { margin-top: 12px; }
.sec-whole { padding-top: 18px !important; }
.mh { margin-bottom: 10px; }
.mh span { display: inline-block; padding: 3px 12px; border-radius: 20px; font-size: 10.5px; font-weight: 700; }
.card:nth-child(4n+1) .mh span { background: #E5E9FF; color: #3D5AFE; }
.card:nth-child(4n+2) .mh span { background: #FFE6EA; color: #E23A5F; }
.card:nth-child(4n+3) .mh span { background: #DFF7EA; color: #17945C; }
.card:nth-child(4n) .mh span { background: #FFF1D9; color: #C27A06; }
.e + .e, .li + .li { margin-top: 10px; }
.e-title { font-size: 12px; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return stackResume(cv, ctx, { cards: true, header: (c) => `<header class="head card">${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}</div>${hx.crow(c)}</header>`, heading: (t) => `<h2 class="mh"><span>${hx.esc(t)}</span></h2>`, contact: false })
}
