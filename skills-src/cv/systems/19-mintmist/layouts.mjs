/**
 * Mint Mist: A mint and lemon glow behind a large intro line, label column layout, photo top left. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page::before { content: ""; position: absolute; right: -120px; top: -160px; width: 620px; height: 560px; background: radial-gradient(closest-side, rgba(170, 238, 205, .75), rgba(250, 245, 170, .45) 55%, rgba(255, 255, 255, 0)); }
.page > * { position: relative; }
.head { display: grid; grid-template-columns: 76px 1fr; gap: 28px; padding: 52px 56px 18px; }
.ph { width: 76px; height: 76px; border-radius: 50%; }
.crow { flex-direction: column; gap: 0; font-size: 9px; color: var(--c-muted); }
.idline { margin-top: 12px; font-size: 14px; font-weight: 700; color: var(--c-ink); }
.intro { margin-top: 6px; font-size: 15px; line-height: 1.4; color: var(--c-ink); }
.main .flow { padding: 8px 56px 40px; }
.page-cont .main .flow { padding-top: 56px; }
.lrow { --label-w: 104px; --label-gap: 28px; }
.lrow-first { padding-top: 22px; }
.lrow-label { font-size: 10px; color: var(--c-muted); }
.lrow-body { padding-bottom: 11px; }
.e-head { display: block; }
.e-title { font-size: 11px; }
.tags li { background: none; padding: 0; border-radius: 0; }
.tags li + li::before { content: "|  "; color: var(--c-muted); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return labelResume(cv, ctx, { profileInHeader: true, header: (c) => `<header class="head">${hx.photo(c, ctx)}<div class="head-copy">${hx.crow(c)}<div class="idline">${hx.esc(c.name)}, ${hx.esc(c.role ?? '')}</div>${hx.profile(c)}</div></header>` })
}
