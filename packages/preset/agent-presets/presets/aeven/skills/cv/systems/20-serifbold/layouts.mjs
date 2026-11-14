/**
 * Serif Bold: A huge black serif name beside a round photo, small caps labels in a quiet left column. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { padding: 34px 54px 6px; }
.top { display: flex; justify-content: space-between; align-items: baseline; font-size: 9px; color: var(--c-text); }
.crow { gap: 0; }
.crow span + span::before { content: "|"; margin: 0 8px; color: var(--c-muted); }
.hero { display: flex; align-items: center; gap: 26px; margin-top: 30px; }
.ph { width: 92px; height: 92px; border-radius: 50%; }
.name { font-family: var(--display-font); font-size: 46px; font-weight: 900; line-height: .95; text-transform: uppercase; color: var(--c-ink); max-width: 420px; }
.main .flow { padding: 20px 54px 40px; }
.page-cont .main .flow { padding-top: 54px; }
.lrow { --label-w: 118px; --label-gap: 22px; }
.lrow-first { padding-top: 18px; }
.lrow-label { padding-top: 2px; font-size: 8.5px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: var(--c-muted); }
.lrow-body { padding-bottom: 10px; }
.e-head { display: block; }
.e-title { font-size: 11px; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return labelResume(cv, ctx, { header: (c) => `<header class="head"><div class="top"><span>${hx.esc(c.role ?? '')}</span>${hx.crow(c)}</div><div class="hero">${hx.photo(c, ctx)}${hx.name(c)}</div></header>` })
}
