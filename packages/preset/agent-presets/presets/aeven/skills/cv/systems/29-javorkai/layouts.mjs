/**
 * Javorkai: Swiss A4: a large name, a square photo, section labels running up the margin, dates in their own column. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { display: flex; justify-content: space-between; align-items: flex-start; padding: 48px 50px 30px 80px; }
.name { font-size: 40px; font-weight: 600; line-height: 1; letter-spacing: -.03em; color: var(--c-ink); }
.role { margin-top: 6px; font-size: 12px; color: var(--c-muted); }
.crow { flex-direction: column; gap: 1px; margin-top: 18px; font-size: 9.5px; }
.ph { width: 128px; height: 128px; filter: grayscale(1); }
.main .flow { padding: 0 50px 40px 40px; }
.page-cont .main .flow { padding-top: 50px; }
.lrow { --label-w: 22px; --label-gap: 18px; }
.lrow-first { padding-top: 14px; border-top: 1px solid var(--c-rule); }
.flow > .lrow-first:first-child { padding-top: 14px !important; }
.lrow-label { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 9px; font-weight: 600; letter-spacing: .14em; text-transform: uppercase; color: var(--c-muted); }
.lrow-body { padding-bottom: 12px; }
.e-main { display: grid; grid-template-columns: 150px 1fr; column-gap: 18px; }
.e-head { display: block; grid-row: span 3; }
.e-title { font-size: 11.5px; font-weight: 600; }
.e-text, .e-points { grid-column: 2; margin-top: 0; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return labelResume(cv, ctx, { header: (c) => `<header class="head"><div>${hx.name(c)}${hx.role(c)}${hx.crow(c)}</div>${hx.photo(c, ctx)}</header>` })
}
