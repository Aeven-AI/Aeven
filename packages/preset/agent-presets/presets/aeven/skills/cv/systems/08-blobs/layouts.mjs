/**
 * Blobs: a white page with three bright overlapping blobs (pink, green, cyan) down the upper left.
 * The photo sits inside the pink blob, the name in big caps over the green; contact, skills and
 * languages follow in the left column, the profile and timelines run on the right.
 */
import { BASE, esc, photo, standardParts } from '../../scripts/blocks.mjs'

const BLOB = 'M60 8C108 -8 170 14 186 66C204 122 168 148 172 196C176 252 128 286 76 270C22 254 -6 210 2 156C8 116 30 104 22 70C14 36 30 18 60 8Z'

export function css() {
  return BASE + `
.page { position: relative; overflow: hidden; background: var(--c-page); color: var(--c-text); font-size: 10.5px; line-height: 1.6; }
.blobs { position: absolute; left: -40px; top: -60px; width: 420px; height: 760px; pointer-events: none; }
.blobs svg { position: absolute; mix-blend-mode: multiply; }
.cols { position: relative; padding: 46px 46px 38px; gap: 40px; }
.page-cont .cols { padding-top: 46px; }
.side { width: 238px; flex: none; }
.main { flex: 1 1 auto; padding-top: 6px; }
.who { position: relative; height: 410px; }
.ph-wrap { position: absolute; left: 10px; top: 0; width: 210px; height: 290px; clip-path: path('${BLOB}'); transform: scale(1.12); transform-origin: 0 0; }
.ph { width: 100%; height: 100%; object-fit: cover; }
.no-photo { background: var(--c-pink); color: #fff; font-size: 48px; font-weight: 800; }
.name { position: absolute; left: 0; top: 314px; font-size: 38px; font-weight: 800; line-height: .98; letter-spacing: -.02em; text-transform: uppercase; color: var(--c-ink); }
.role { position: absolute; left: 2px; top: 396px; font-size: 12px; font-weight: 600; color: var(--c-ink); }
.slab, .mlab { font-size: 11px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--c-ink); }
.slab { margin-bottom: 8px; }
.side-sec { padding-top: 22px; }
.ct-row { margin-bottom: 6px; }
.ct-label { font-size: 8.5px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--c-muted); }
.ct-value { color: var(--c-ink); font-weight: 500; overflow-wrap: anywhere; }
.sk-dots .sk-item + .sk-item { margin-top: 5px; }
.sk-name { color: var(--c-ink); }
.sk-pips i { width: 8px; height: 8px; color: var(--c-ink); }
.lg-item { padding: 2px 0; }
.lg-name { color: var(--c-ink); font-weight: 500; }
.lg-level { color: var(--c-muted); }
.tags { gap: 5px; }
.tags li { padding: 2px 10px; border-radius: 20px; border: 1.5px solid var(--c-ink); font-size: 9.5px; font-weight: 600; color: var(--c-ink); }
.mlab { display: inline-block; margin-bottom: 10px; padding: 3px 10px; border-radius: 20px; background: var(--c-ink); color: #fff; }
.sec-head, .main .sec-whole { padding-top: 20px; }
.main .flow > :first-child { padding-top: 0; }
.sec-item { padding-bottom: 14px; }
.e-title { font-size: 13px; font-weight: 800; color: var(--c-ink); }
.e-org { font-size: 10.5px; font-weight: 600; color: var(--c-text); }
.e-dates { flex: none; padding: 1px 8px; border-radius: 20px; background: rgba(47, 224, 139, .25); font-size: 9px; font-weight: 600; color: var(--c-ink); }
.e-text { margin-top: 4px; }
.e-points { margin-top: 4px; }
.li-title { font-size: 11.5px; font-weight: 800; color: var(--c-ink); }
.li-meta { font-size: 9.5px; font-weight: 600; color: var(--c-muted); }
.s-text { color: var(--c-text); }
`
}

export function pages(cv, ctx) {
  const sideHeading = (t) => `<div class="slab">${esc(t)}</div>`
  const mainHeading = (t) => `<div class="mlab">${esc(t)}</div>`
  const { side, main } = standardParts(cv, ctx, { sideHeading, mainHeading, skillsLook: 'dots', languagesLook: 'lines' })
  const blob = (color, x, y, w, rot) => `<svg viewBox="0 0 190 280" style="left:${x}px;top:${y}px;width:${w}px;transform:rotate(${rot}deg)"><path d="${BLOB}" fill="var(--c-${color})"/></svg>`
  const blobs = `<div class="blobs">${blob('cyan', 170, 190, 170, 160)}${blob('green', 0, 250, 190, 40)}${blob('pink', 20, 30, 260, -8)}</div>`
  const who = `<div class="who" data-block><div class="ph-wrap">${photo(ctx, cv, 'ph')}</div><h1 class="name">${esc(cv.name).replace(' ', '<br>')}</h1>${cv.role ? `<div class="role">${esc(cv.role)}</div>` : ''}</div>`
  const page = (kind, deco, s, m) => `<section class="page ${kind}">${deco}<div class="cols"><aside class="side" data-col="side"><div class="flow">${s}</div></aside><main class="main" data-col="main"><div class="flow">${m}</div></main></div></section>`
  return { first: page('page-first', blobs, who + side.join(''), main.join('')), continuation: page('page-cont', '', '', '') }
}
