/**
 * Confetti: Centred round photo in a scatter of pastel confetti, numbered section labels and soft grey chips. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.head { position: relative; margin: 0 52px; padding: 40px 0 18px; text-align: center; border-bottom: 1px solid var(--c-rule); }
.cf { position: absolute; display: block; }
.cf-o { width: 10px; height: 10px; border: 2px solid var(--k); border-radius: 50%; }
.cf-l { width: 14px; height: 2.5px; background: var(--k); transform: rotate(-35deg); }
.cf-t { width: 0; height: 0; border-left: 6px solid transparent; border-right: 6px solid transparent; border-bottom: 10px solid var(--k); transform: rotate(20deg); }
.ph { width: 70px; height: 70px; margin: 0 auto; border-radius: 50%; }
.name { margin-top: 10px; font-size: 18px; font-weight: 700; color: var(--c-ink); }
.role { font-size: 10px; color: var(--c-muted); }
.crow { justify-content: center; gap: 4px 26px; margin-top: 14px; font-size: 9.5px; }
.main .flow { padding: 6px 52px 40px; }
.page-cont .main .flow { padding-top: 52px; }
.lrow { --label-w: 150px; }
.lrow-first { padding-top: 18px; }
.lrow-label { font-size: 10.5px; font-weight: 700; text-transform: uppercase; color: var(--c-ink); }
.lrow-label b { margin-right: 4px; }
.lrow-body { padding-bottom: 10px; }
.e-title { font-size: 11px; }
.e-head { display: block; }
.e-org { order: -1; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  const dots = [['c1', 70, 30, 'o'], ['c2', 640, 40, 't'], ['c3', 120, 120, 'l'], ['c4', 600, 140, 'o'], ['c2', 220, 30, 'l'], ['c1', 540, 70, 't'], ['c3', 700, 120, 'o'], ['c4', 40, 150, 't']]
  const confetti = dots.map(([c, x, y, k]) => `<i class="cf cf-${k}" style="left:${x}px;top:${y}px;--k:var(--c-${c})"></i>`).join('')
  return labelResume(cv, ctx, { numbered: true, header: (c) => `<header class="head">${confetti}${hx.photo(c, ctx)}${hx.name(c)}${hx.role(c)}${hx.crow(c)}</header>` })
}
