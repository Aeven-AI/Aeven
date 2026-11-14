/**
 * Minimal Rule: Square photo and name over hairlines, spaced caps labels, everything on a strict grid. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { display: grid; grid-template-columns: 84px 1fr auto; gap: 22px; align-items: center; margin: 0 54px; padding: 50px 0 22px; border-bottom: 1px solid var(--c-ink); }
.ph { width: 84px; height: 84px; border-radius: 8px; }
.name { font-size: 26px; font-weight: 600; letter-spacing: -.02em; color: var(--c-ink); }
.role { font-size: 11px; color: var(--c-muted); }
.crow { flex-direction: column; gap: 1px; text-align: right; font-size: 9px; color: var(--c-text); }
.main .flow { padding: 0 54px 40px; }
.page-cont .main .flow { padding-top: 54px; }
.lrow { --label-w: 120px; }
.lrow-first { margin-top: 0; padding-top: 16px; border-top: 1px solid var(--c-rule); }
.flow > .lrow-first:first-child { border-top: 0; padding-top: 18px !important; }
.lrow-label { font-size: 8.5px; font-weight: 600; letter-spacing: .16em; text-transform: uppercase; color: var(--c-ink); }
.lrow-body { padding-bottom: 12px; }
.e-title { font-size: 11px; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return labelResume(cv, ctx, { header: (c) => `<header class="head">${hx.photo(c, ctx)}<div class="id">${hx.name(c)}${hx.role(c)}</div>${hx.crow(c)}</header>` })
}
