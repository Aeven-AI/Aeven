/**
 * Judit: Warm ivory page, a serif name and coral accents, round photo and tidy hairline sections. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { display: flex; gap: 22px; align-items: center; margin: 0 58px; padding: 50px 0 24px; border-bottom: 1px solid var(--c-rule); }
.ph { width: 86px; height: 86px; border-radius: 50%; }
.name { font-family: var(--display-font); font-size: 32px; font-weight: 500; font-style: italic; line-height: 1.1; color: var(--c-ink); }
.role { margin-top: 2px; font-size: 9.5px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--c-accent); }
.crow { margin-top: 10px; font-size: 9.5px; color: var(--c-text); }
.crow span::before { content: "◦ "; color: var(--c-accent); }
.main .flow { padding: 6px 58px 40px; }
.page-cont .main .flow { padding-top: 58px; }
.mh { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; font-size: 9.5px; font-weight: 700; letter-spacing: .16em; text-transform: uppercase; color: var(--c-accent); }
.mh::after { content: ""; flex: 1; height: 1px; background: var(--c-rule); }
.sec-head, .sec-whole { padding-top: 22px; }
.e-title { font-family: var(--display-font); font-size: 14px; font-weight: 600; }
.e-dates { font-size: 9px; letter-spacing: .06em; }
.li-title { font-family: var(--display-font); font-size: 13px; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return stackResume(cv, ctx, { header: (c) => `<header class="head">${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}${hx.crow(c)}</div></header>`, heading: (t) => `<h2 class="mh">${hx.esc(t)}</h2>`, contact: false })
}
