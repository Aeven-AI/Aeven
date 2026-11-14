/**
 * Sunny: A bold yellow header with a big hello, the photo in an arch, pink chips and playful type. Built on the `kit.mjs` archetypes.
 */
import { KIT, hx, labelResume, sidebarResume, stackResume } from '../../scripts/kit.mjs'

/** The stylesheet; colours come from the palette as `--c-<name>`. */
export function css() {
  return KIT + `
.band { display: flex; justify-content: space-between; align-items: flex-end; height: 260px; padding: 0 48px; background: var(--c-band); }
.hi { display: inline-block; padding: 4px 16px; border-radius: 30px; background: var(--c-accent); font-size: 20px; font-weight: 800; color: #fff; transform: rotate(-4deg); }
.band > div { padding-bottom: 38px; }
.name { margin-top: 14px; font-size: 40px; font-weight: 800; line-height: .95; letter-spacing: -.02em; color: var(--c-ink); }
.role { margin-top: 8px; font-size: 13px; font-weight: 600; color: var(--c-ink); }
.ph { width: 190px; height: 228px; border-radius: 120px 120px 0 0; }
.cols { padding: 28px 48px 40px; gap: 34px; }
.page-cont .cols { padding-top: 48px; }
.side { width: 190px; flex: none; }
.main { flex: 1; }
.sh, .mh { display: inline-block; margin-bottom: 9px; padding: 2px 12px; border-radius: 20px; background: var(--c-ink); font-size: 11px; font-weight: 700; color: #fff; }
.e-head { display: block; }
.e-title { font-size: 12.5px; font-weight: 800; }
.e-dates { color: var(--c-accent); font-weight: 600; }
`
}

/** The pages. */
export function pages(cv, ctx) {
  return sidebarResume(cv, ctx, { header: (c) => `<header class="band"><div><div class="hi">${hx.esc(ctx.labels.greetingShort ?? 'Hi!')}</div>${hx.name(c)}${hx.role(c)}</div>${hx.photo(c, ctx)}</header>`, skillsLook: 'chips' })
}
