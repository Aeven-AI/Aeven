/**
 * Brix: Clean Manrope resume: rounded photo, violet role, contact chips, dates in a left column and violet section bars. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { display: flex; gap: 24px; align-items: center; padding: 46px 52px 24px; }
.ph { width: 100px; height: 100px; border-radius: 22px; }
.name { font-size: 28px; font-weight: 800; letter-spacing: -.02em; color: var(--c-ink); }
.role { font-size: 12px; font-weight: 600; color: var(--c-accent); }
.crow { gap: 6px; margin-top: 10px; }
.crow span { padding: 3px 10px; border-radius: 20px; background: var(--c-chip); font-size: 9px; color: var(--c-ink); }
.main .flow { padding: 0 52px 40px; }
.page-cont .main .flow { padding-top: 52px; }
.mh { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 14px; font-weight: 800; color: var(--c-ink); }
.mh::before { content: ""; width: 4px; height: 16px; border-radius: 4px; background: var(--c-accent); }
.sec-head, .sec-whole { padding-top: 20px; }
.e-main { display: grid; grid-template-columns: 110px 1fr; column-gap: 18px; }
.e-head { display: contents; }
.e-dates { grid-column: 1; grid-row: 1; padding-top: 2px; color: var(--c-accent); font-weight: 600; }
.e-name { grid-column: 2; grid-row: 1; }
.e-text, .e-points { grid-column: 2; }
.e-title { font-size: 12px; font-weight: 800; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return stackResume(cv, ctx, { header: (c) => `<header class="head">${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}${hx.crow(c)}</div></header>`, heading: (t) => `<h2 class="mh">${hx.esc(t)}</h2>`, contact: false })
}
