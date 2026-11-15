/**
 * Khalil: Charcoal page with yellow accents, a ringed round photo and a soft side card. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { display: flex; gap: 24px; align-items: center; padding: 44px 46px 26px; }
.ph { width: 104px; height: 104px; border-radius: 50%; box-shadow: 0 0 0 4px var(--c-accent); }
.name { font-size: 28px; font-weight: 700; line-height: 1.1; color: var(--c-ink); }
.role { font-size: 12px; font-weight: 500; color: var(--c-accent-text); }
.crow { margin-top: 10px; font-size: 9.5px; color: var(--c-text); }
.cols { padding: 0 46px 40px; gap: 26px; }
.page-cont .cols { padding-top: 46px; }
.side { width: 200px; flex: none; padding: 18px; border-radius: 16px; background: var(--c-side); }
.main { flex: 1; }
.sh, .mh { margin-bottom: 9px; font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--c-accent-text); }
.e-head { display: block; }
.e-title { font-size: 12px; font-weight: 600; }
.sk-bar { height: 5px; background: var(--c-rule); }
.sk-bar span { background: var(--c-accent); }
.lg-pips i { color: var(--c-accent); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { header: (c) => `<header class="head">${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}${hx.crow(c)}</div></header>`, skillsLook: 'bars', languagesLook: 'dots' })
}
