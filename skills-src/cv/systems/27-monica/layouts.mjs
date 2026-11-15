/**
 * Mónica: A sky blue top edge, name with a blue subtitle, round photo right, two columns with spaced caps labels. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page { border-top: 14px solid var(--c-accent); }
.head { display: flex; justify-content: space-between; align-items: center; padding: 34px 50px 18px; }
.name { font-size: 28px; font-weight: 500; color: var(--c-ink); }
.role { font-size: 15px; color: var(--c-accent); }
.crow { display: grid; grid-template-columns: repeat(2, auto); justify-content: start; gap: 4px 34px; margin-top: 12px; font-size: 9.5px; }
.crow span::before { content: "●"; margin-right: 6px; font-size: 7px; color: var(--c-accent); vertical-align: 1px; }
.ph { width: 96px; height: 96px; border-radius: 50%; }
.cols { padding: 10px 50px 40px; gap: 34px; }
.page-cont .cols { padding-top: 40px; }
.main { flex: 1; }
.side { width: 200px; flex: none; }
.sh, .mh { margin-bottom: 10px; padding-bottom: 5px; border-bottom: 2px solid var(--c-rule); font-size: 9.5px; font-weight: 700; letter-spacing: .14em; text-transform: uppercase; color: var(--c-muted); }
.e-head { display: block; }
.e-title { font-size: 13px; font-weight: 700; }
.e-org { font-size: 11px; color: var(--c-accent); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { right: true, contactSide: false, profileSide: true, header: (c) => `<header class="head"><div>${hx.name(c)}${hx.role(c)}${hx.crow(c)}</div>${hx.photo(c, ctx)}</header>`, skillsLook: 'chips' })
}
