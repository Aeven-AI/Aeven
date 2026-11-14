/**
 * Marina: Electric blue edge with pink and yellow diamonds, bold Space Grotesk, skills on pink grid paper. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page::before { content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 22px; background: var(--c-accent); }
.head { position: relative; display: grid; grid-template-columns: 96px 1fr auto; gap: 24px; align-items: center; padding: 48px 48px 20px 64px; }
.edge { position: absolute; inset: 0; pointer-events: none; }
.edge i { position: absolute; left: 4px; width: 26px; height: 26px; transform: rotate(45deg); border-radius: 4px; background: var(--c-pink); }
.edge i:nth-child(1) { top: 70px; }
.edge i:nth-child(2) { top: 300px; background: var(--c-yellow); }
.edge i:nth-child(3) { top: 620px; }
.ph { width: 96px; height: 96px; border-radius: 50%; box-shadow: 0 0 0 4px var(--c-yellow); }
.name { font-size: 26px; font-weight: 700; line-height: 1.05; color: var(--c-ink); }
.role { margin-top: 4px; font-size: 13px; font-weight: 500; color: var(--c-accent); }
.crow { flex-direction: column; gap: 1px; font-size: 9px; text-align: right; }
.cols { padding: 16px 48px 40px 64px; gap: 30px; }
.page-cont .cols { padding-top: 48px; }
.main { flex: 1; }
.side { width: 200px; flex: none; }
.sh, .mh { margin-bottom: 9px; font-size: 15px; font-weight: 700; color: var(--c-ink); }
.side-sec:nth-child(2) { margin-top: 18px; padding: 14px; border-radius: 10px; background-color: #FFF4F7; background-image: linear-gradient(var(--c-grid) 1px, transparent 1px), linear-gradient(90deg, var(--c-grid) 1px, transparent 1px); background-size: 14px 14px; }
.e-head { display: block; }
.e-title { font-size: 12px; }
.e-dates { color: var(--c-accent); }
.tags li { background: #fff; border: 1.5px solid var(--c-ink); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { right: true, educationSide: true, header: (c) => `<header class="head"><div class="edge"><i></i><i></i><i></i></div>${hx.photo(c, ctx)}<div>${hx.name(c)}${hx.role(c)}</div>${hx.crow(c)}</header>`, skillsLook: 'chips' })
}
