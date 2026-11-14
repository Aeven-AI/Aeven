/**
 * Supa: Modern card resume: big rounded photo in a pale side column, colour-coded contact, entries as cards with icon tiles. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page { font-size: 10px; }
.cols { flex: 1 1 auto; }
.side { width: 230px; flex: none; background: var(--c-side); border-right: 1px solid var(--c-rule); }
.side .flow { padding: 30px 24px 36px; }
.main { flex: 1; }
.main .flow { padding: 34px 34px 36px; }
.ph { width: 100%; height: 200px; border-radius: 14px; }
.name { margin-top: 14px; font-size: 19px; font-weight: 800; color: var(--c-ink); }
.role { font-size: 11px; font-weight: 600; color: var(--c-accent); }
.sh { margin-bottom: 8px; font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--c-muted); }
.side-sec { padding-top: 20px; }
.ct-row { position: relative; padding-left: 22px; margin-bottom: 8px; }
.ct-row::before { content: ""; position: absolute; left: 0; top: 3px; width: 14px; height: 14px; border-radius: 4px; background: var(--c-accent); opacity: .85; }
.ct-row:nth-child(2)::before { background: #F25F7A; }
.ct-row:nth-child(3)::before { background: #22B07D; }
.ct-row:nth-child(4)::before { background: #F5A524; }
.mh { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; font-size: 14px; font-weight: 800; color: var(--c-ink); }
.mh i { width: 18px; height: 18px; border-radius: 5px; background: var(--c-accent); }
.e { display: flex; gap: 12px; padding: 10px 12px; border: 1px solid var(--c-rule); border-radius: 12px; background: var(--c-card); }
.e-icon { flex: none; width: 30px; height: 30px; padding: 6px; border-radius: 8px; background: var(--c-accent); color: #fff; stroke-width: 2; }
.e-main { flex: 1; min-width: 0; }
.e-title { font-size: 11.5px; font-weight: 800; }
.sec-item { padding-bottom: 8px; }
.tags li { background: var(--c-chip); color: var(--c-ink); border-radius: 6px; }
.li { padding: 9px 12px; border: 1px solid var(--c-rule); border-radius: 12px; background: var(--c-card); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { icons: true, sideTop: (c) => `${hx.photo(c, ctx)}${hx.name(c)}${hx.role(c)}`, skillsLook: 'chips', languagesLook: 'lines', mainHeading: (t) => `<h2 class="mh"><i></i>${hx.esc(t)}</h2>` })
}
