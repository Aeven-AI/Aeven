/**
 * Kit: A white rounded sheet on a soft lavender frame, small rounded photo, violet role and label column. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page { padding: 26px; background: var(--c-frame); }
.page > header, .page > main { background: var(--c-page); }
.head { display: grid; grid-template-columns: 64px 1fr auto; gap: 18px; align-items: center; padding: 30px 34px 20px; border-radius: 22px 22px 0 0; }
.page-cont .main { border-radius: 22px; }
.main { border-radius: 0 0 22px 22px; }
.ph { width: 64px; height: 64px; border-radius: 16px; }
.name { font-size: 22px; font-weight: 700; color: var(--c-ink); }
.role { font-size: 11px; font-weight: 500; color: var(--c-accent); }
.crow { flex-direction: column; gap: 1px; text-align: right; font-size: 9px; color: var(--c-text); }
.main .flow { padding: 0 34px 30px; }
.page-cont .main .flow { padding-top: 30px; }
.lrow { --label-w: 110px; }
.lrow-first { padding-top: 16px; border-top: 1px solid var(--c-rule); }
.lrow-label { font-size: 10px; font-weight: 600; color: var(--c-muted); }
.lrow-body { padding-bottom: 11px; }
.e-title { font-size: 11.5px; }
.tags li { background: var(--c-chip); color: var(--c-accent); font-weight: 500; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return labelResume(cv, ctx, { header: (c) => `<header class="head">${hx.photo(c, ctx)}<div class="id">${hx.name(c)}${hx.role(c)}</div>${hx.crow(c)}</header>` })
}
