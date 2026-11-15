/**
 * Bluewash: Royal blue name, navy and peach paper shapes in the corners, a clean right side column. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page::after { content: ""; position: absolute; right: -60px; bottom: -70px; width: 220px; height: 200px; border-radius: 50%; background: var(--c-navy); }
.head { position: relative; display: flex; justify-content: space-between; align-items: flex-end; padding: 50px 50px 20px; }
.head i { position: absolute; display: block; }
.sh1 { right: -30px; top: -40px; width: 130px; height: 130px; border-radius: 50%; background: var(--c-peach); }
.sh2 { right: 70px; top: -30px; width: 70px; height: 70px; border-radius: 0 0 70px 0; background: var(--c-navy); }
.sh3 { right: 10px; top: 80px; width: 40px; height: 40px; border-radius: 50%; background: var(--c-pink); }
.sh4 { left: -40px; top: -40px; width: 90px; height: 90px; border-radius: 0 0 90px 0; background: #E9EDFF; }
.name { position: relative; font-size: 30px; font-weight: 800; color: var(--c-accent); }
.role { position: relative; font-size: 11px; color: var(--c-muted); }
.ph { position: relative; width: 92px; height: 92px; margin-right: 90px; border-radius: 16px; }
.cols { position: relative; padding: 14px 50px 40px; gap: 36px; }
.page-cont .cols { padding-top: 50px; }
.main { flex: 1; }
.side { width: 180px; flex: none; }
.sh, .mh { margin-bottom: 9px; font-size: 13px; font-weight: 800; color: var(--c-accent); }
.e-head { display: block; }
.e-title { font-size: 11.5px; }
.sk-level { display: none; }
.lg-bar, .sk-bar { height: 4px; background: #E7EAF8; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  const shapes = `<i class="sh1"></i><i class="sh2"></i><i class="sh3"></i><i class="sh4"></i>`
  return sidebarResume(cv, ctx, { right: true, contactSide: true, header: (c) => `<header class="head">${shapes}<div>${hx.name(c)}${hx.role(c)}</div>${hx.photo(c, ctx)}</header>`, languagesLook: 'bars' })
}
