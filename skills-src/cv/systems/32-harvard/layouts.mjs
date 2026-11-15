/**
 * Harvard: The classic academic resume: centred serif name, full-width rules, places and dates aligned right, no photo. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.page { font-size: 11px; line-height: 1.35; }
.head { padding: 52px 64px 6px; text-align: center; }
.name { font-size: 22px; font-weight: 700; color: var(--c-ink); }
.crow { justify-content: center; gap: 0; margin-top: 4px; font-size: 10.5px; }
.crow span + span::before { content: "•"; margin: 0 8px; }
.main .flow { padding: 6px 64px 40px; }
.page-cont .main .flow { padding-top: 52px; }
.mh { margin-bottom: 6px; padding-bottom: 2px; border-bottom: 1px solid var(--c-rule); font-size: 11.5px; font-weight: 700; text-transform: uppercase; text-align: center; color: var(--c-ink); }
.sec-head, .sec-whole { padding-top: 14px; }
.sec-item { padding-bottom: 8px; }
.e-name { display: flex; flex-direction: column; }
.e-org { font-weight: 700; color: var(--c-ink); font-size: 11px; }
.e-title { font-style: italic; font-weight: 400; font-size: 11px; }
.e-dates { color: var(--c-ink); font-size: 10.5px; }
.e-text { margin-top: 2px; }
.e-points li::before { width: 3px; height: 3px; opacity: 1; }
.li-title { font-weight: 700; }
.li-meta { color: var(--c-ink); }
.sk-list .sk-item { display: block; }
.sk-note::before { content: ": "; }
.tags li { padding: 0; border-radius: 0; background: none; font-size: 11px; }
.tags li + li::before { content: ", "; }
.tags { gap: 0; }
.lg-inline .lg-level::before { content: "("; margin: 0; opacity: 1; }
.lg-inline .lg-level::after { content: ")"; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return stackResume(cv, ctx, { header: (c) => `<header class="head">${hx.name(c)}${hx.crow(c)}</header>`, heading: (t) => `<h2 class="mh">${hx.esc(t)}</h2>`, entryOpts: { orgFirst: true }, skillsLook: 'list' })
}
