/**
 * Resumate: White page with a black diagonal corner and a soft pink glow, blue name and section titles. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page::before { content: ""; position: absolute; left: -10px; bottom: -10px; width: 300px; height: 230px; background: #111; clip-path: polygon(0 35%, 100% 100%, 0 100%); }
.page::after { content: ""; position: absolute; right: -140px; top: -140px; width: 420px; height: 420px; border-radius: 50%; background: radial-gradient(closest-side, rgba(255, 190, 210, .7), rgba(255, 255, 255, 0)); }
.page > * { position: relative; z-index: 1; }
.head { display: flex; gap: 22px; align-items: center; padding: 48px 48px 22px; }
.ph { width: 92px; height: 92px; border-radius: 50%; }
.name { font-size: 30px; font-weight: 800; letter-spacing: -.02em; color: var(--c-accent); }
.role { font-size: 12px; color: var(--c-ink); }
.cols { padding: 8px 48px 40px; gap: 34px; }
.page-cont .cols { padding-top: 48px; }
.main { flex: 1; }
.side { width: 180px; flex: none; }
.sh, .mh { margin-bottom: 9px; font-size: 12px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--c-accent); }
.e-head { display: block; }
.e-title { font-size: 12px; }
.e-dates { color: var(--c-accent); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { right: true, header: (c) => `<header class="head">${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}</div></header>`, skillsLook: 'list' })
}
