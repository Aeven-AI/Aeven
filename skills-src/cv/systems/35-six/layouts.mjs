/**
 * Six: A pale blue side column and header, square photo, pink section titles in Work Sans. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.cols { flex: 1 1 auto; }
.side { width: 230px; flex: none; background: var(--c-side); }
.side .flow { padding: 40px 26px 36px; }
.main { flex: 1; }
.main .flow { padding: 44px 40px 36px; }
.ph { width: 120px; height: 140px; border-radius: 6px; }
.name { margin-top: 14px; font-size: 22px; font-weight: 700; line-height: 1.15; color: var(--c-ink); }
.role { font-size: 11px; color: var(--c-muted); }
.side-sec { padding-top: 22px; }
.sh, .mh { margin-bottom: 9px; font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--c-accent); }
.mh { font-size: 13px; }
.e-head { display: block; }
.e-title { font-size: 12px; }
.sk-level { display: none; }
.sk-bar, .lg-bar { height: 4px; background: #fff; }
.sk-bar span, .lg-bar span { background: var(--c-accent); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { sideTop: (c) => `${hx.photo(c, ctx)}${hx.name(c)}${hx.role(c)}`, languagesLook: 'bars' })
}
