/**
 * Sunbeam: White page, photo and name top left, a sunny yellow-to-blue gradient side column on the right. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.cols { flex: 1 1 auto; }
.main { flex: 1; }
.main .flow { padding: 48px 34px 40px 50px; }
.side { width: 230px; flex: none; background: linear-gradient(180deg, var(--c-sun) 0%, #FFF8D6 38%, #F4F7FF 70%, var(--c-sky) 100%); }
.side .flow { padding: 110px 28px 40px; }
.page-cont .side .flow { padding-top: 48px; }
.who { display: flex; align-items: center; gap: 16px; padding-bottom: 6px; }
.ph { width: 64px; height: 64px; border-radius: 50%; }
.name { font-size: 22px; font-weight: 700; line-height: 1.15; color: var(--c-ink); }
.role { margin-top: 2px; font-size: 11px; color: var(--c-muted); }
.sh { margin-bottom: 8px; font-size: 14px; font-weight: 700; color: var(--c-ink); }
.mh { margin-bottom: 8px; font-size: 15px; font-weight: 700; color: var(--c-ink); }
.side-sec { padding-top: 22px; }
.e-head { display: block; }
.e-title { font-size: 11.5px; }
.sk-level { display: none; }
.sk-bar { height: 3px; background: rgba(0, 0, 0, .1); }
.sk-bar span { background: #161616; }
.tags li { background: rgba(255, 255, 255, .7); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { right: true, mainTop: (c) => `<div class="who">${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}</div></div>`, languagesLook: 'lines' })
}
