/**
 * Aurora: A pink-to-lilac gradient header with a round photo and link chips, then a calm label column. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { padding: 38px 50px 26px; text-align: center; background: linear-gradient(135deg, var(--c-g1), var(--c-g2) 55%, var(--c-g3)); border-radius: 0 0 28px 28px; }
.ph { width: 78px; height: 78px; margin: 0 auto; border-radius: 50%; border: 3px solid rgba(255, 255, 255, .7); }
.name { margin-top: 10px; font-size: 22px; font-weight: 700; color: var(--c-head-ink); }
.role { font-size: 11px; color: var(--c-head-ink); opacity: .75; }
.crow { justify-content: center; gap: 6px; margin-top: 12px; }
.crow span { padding: 3px 10px; border-radius: 20px; background: rgba(255, 255, 255, .35); font-size: 9px; color: var(--c-head-ink); }
.main .flow { padding: 6px 50px 36px; }
.page-cont .main .flow { padding-top: 46px; }
.lrow { --label-w: 120px; }
.lrow-first { padding-top: 18px; }
.lrow-label { font-size: 10px; font-weight: 700; color: var(--c-muted); }
.lrow-body { padding-bottom: 11px; }
.e-title { font-size: 11.5px; }
.tags li { background: var(--c-chip); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return labelResume(cv, ctx, { header: (c) => `<header class="head">${hx.photo(c, ctx)}${hx.name(c)}${hx.role(c)}${hx.crow(c)}</header>` })
}
