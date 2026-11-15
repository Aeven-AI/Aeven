/**
 * Noir Band: A black header band with a centred round photo and contact row over two crisp columns. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.band { padding: 30px 40px 0; background: var(--c-band); color: #fff; text-align: center; }
.ph { width: 76px; height: 76px; margin: 0 auto; border-radius: 50%; border: 3px solid #fff; }
.name { margin-top: 10px; font-size: 22px; font-weight: 700; color: #fff; }
.role { font-size: 10.5px; color: #BDBDBD; }
.crow { justify-content: center; gap: 0; margin-top: 16px; border-top: 1px solid #333; }
.crow span { padding: 10px 18px; font-size: 9.5px; color: #E6E6E6; }
.crow span + span { border-left: 1px solid #333; }
.cols { padding: 28px 46px 40px; }
.page-cont .cols { padding-top: 46px; }
.main { flex: 1; padding-right: 26px; border-right: 1px solid var(--c-rule); }
.side { width: 170px; flex: none; padding-left: 24px; }
.sh, .mh { margin-bottom: 10px; font-size: 13px; font-weight: 800; text-transform: uppercase; color: var(--c-ink); text-decoration: underline; text-decoration-thickness: 2px; text-underline-offset: 5px; }
.e-head { display: block; }
.e-org { font-size: 11px; font-weight: 700; color: var(--c-ink); }
.e-title { font-size: 10.5px; font-weight: 400; }
.sk-level { display: none; }
.sk-bar, .lg-bar { height: 3px; border-radius: 0; background: #E6E6E6; }
.sk-bar span, .lg-bar span { border-radius: 0; background: #111; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { right: true, contactSide: false, header: (c) => `<header class="band">${hx.photo(c, ctx)}${hx.name(c)}${hx.role(c)}${hx.crow(c)}</header>`, languagesLook: 'bars', entryOpts: { orgFirst: true } })
}
