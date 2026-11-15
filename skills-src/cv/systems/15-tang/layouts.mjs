/**
 * Tang: Huge caps name over a hairline, underlined caps headings, black skill bars, no photo. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page { font-size: 10px; }
.head { margin: 0 50px; padding: 52px 0 18px; border-bottom: 1px solid var(--c-rule); }
.name { font-size: 40px; font-weight: 800; line-height: 1; letter-spacing: -.01em; text-transform: uppercase; color: var(--c-ink); }
.role { margin-top: 8px; font-size: 11px; color: var(--c-muted); }
.cols { padding: 24px 50px 40px; }
.page-cont .cols { padding-top: 52px; }
.side { width: 180px; flex: none; padding-right: 22px; border-right: 1px solid var(--c-rule); }
.main { flex: 1; padding-left: 26px; }
.sh, .mh { margin-bottom: 10px; font-size: 13px; font-weight: 800; text-transform: uppercase; color: var(--c-ink); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; }
.ct-label { font-size: 10px; font-weight: 700; color: var(--c-ink); }
.ct-value { color: var(--c-text); }
.sk-level { display: none; }
.sk-bar, .lg-bar { height: 3px; border-radius: 0; background: #E6E6E6; }
.sk-bar span, .lg-bar span { border-radius: 0; background: #111; }
.e-head { display: block; }
.e-org { font-size: 11px; font-weight: 700; color: var(--c-ink); }
.e-title { font-size: 10.5px; font-weight: 400; }
.tags li { background: none; padding: 0; border-radius: 0; }
.tags li + li::before { content: "· "; color: var(--c-muted); }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { header: (c) => `<header class="head">${hx.name(c)}${hx.role(c)}</header>`, languagesLook: 'bars', entryOpts: { orgFirst: true } })
}
