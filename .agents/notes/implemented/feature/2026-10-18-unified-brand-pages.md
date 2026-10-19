# Agent Note: every browser round trip lands on the brand page

Status: implemented

English | [中文](2026-10-18-unified-brand-pages.zh.md)

## Problem

A reader who leaves the application shell — to sign in with a provider, to grant a connector consent, to check out a plan — comes back through a page the product serves itself, and each of those pages looked like a different product. The deployment drew a system-font card with a ✓ or an `!` for a connector outcome, a white serial wordmark for a billing return, and an inherited pink "Please close this window" page for social sign-in. The harness drew a plain-text `Signed in. You can close this window.` for the web-app sign-in, a bare `<p>` for the Slack consent, and its own system-font headings for the xAI loopback. None of them shared a stylesheet, a typeface, or a voice with the coming-soon page the product actually presents.

## Decision

One design owns all of them: `@aeven/brand-page` renders the coming-soon page's lockup — the `#f2f2f2` sheet, the turbulence grain, the Æven wordmark at `clamp(3.25rem, 11vw, 10rem)` weight 520, the `settle` entrance — with one line stating what happened and one quieter line stating what to do next.

### Two states, one stylesheet

`state: 'waiting'` is a page that is on its way somewhere else: the mark and the loading mark cover the lockup until the face is in, then the cover lifts and the wordmark arrives. `state: 'result'` has no cover and settles straight to the wordmark. The waiting pages are the provider handoffs (desktop sign-in, `avn` headless sign-in); the result pages are every finished outcome.

### The face travels with the page

The stylesheet's `@font-face` ships as a data URI: the woff2 lives in the package's `assets/`, and `brandPageHtml` inlines it. A loopback listener on an arbitrary port that serves no asset routes still sets the wordmark in the product's type, and the document opens no connection of its own. The tab icon is an inline data URI for the same reason.

### Pages that cannot run script render the same design

The deployment's callback answers under `default-src 'none'`, so its page carries no script at all: the stylesheet's resting state is the type without the cover, and the entrance animations are keyed on `:not(.fonts-loading)` so they run on load. The harness pages carry the gate — `fonts-loading` before first paint, `fonts-ready` once `document.fonts.load` resolves — so no glyph is ever drawn in a fallback face.

### The deployment keeps a compared copy

The Aeven API is a separate repository that builds on its own, so it carries a CommonJS copy of the renderer and the stylesheet: `services/pages/brandPage.js`. The stylesheet between the `// <brand-page-css>` markers in `packages/util/brand-page/src/page.ts` is the source of record; `scripts/brand-page-css.mjs --check` in that repository fails when the copy drifts, and its unit suite runs the check whenever a harness checkout sits beside it.

### The pages that adopt it

| Page | State | Copy |
|---|---|---|
| Desktop provider sign-in start | waiting | the shell's own locale labels |
| Desktop provider sign-in landing | result | the shell's own locale labels |
| `avn web` headless sign-in start | waiting | `Continuing to sign in…` |
| `avn web` headless sign-in landing | result | `Signed in.` |
| Slack loopback landing | result | the Host's own sentences |
| xAI loopback landing | result | `Signed in.` / `Sign-in failed.` |
| Connector consent callback | result | the deployment's en/zh outcome table |
| Stripe return | result | the deployment's en/zh billing table |

## Alternatives considered

**Keep each page's own markup and copy the colours across.** Rejected: it is exactly the arrangement that produced eight pages with four different typefaces, and any later change to the design would need eight edits across two repositories with nothing noticing a missed one.

**Serve the deployment's pages from the harness package over a shared URL.** Rejected: the deployment answers on the public internet under its own CSP, its own cache policy and its own up time; a page that depends on another service being reachable is a page that fails during an incident.

**Reuse the application shell's `#avn-preloader` for the waiting state.** Rejected: the shell's preloader is a first-paint cover for a document that is about to become an application, styled by the client bundle and following the system colour scheme. These pages are documents in their own right on a plain sheet, and they must render with no bundle at all.

**Keep the font behind a route the listener serves (the desktop's previous `/fonts/...` handler).** Rejected: only some of these listeners can reach a font file — the harness's Slack and xAI loops own no assets — so the same design would have needed two type answers. Inlining one 120 KB face costs one request fewer than the route it replaces.

## Consequences

Every page outside the shell now reads as the same product as the page a visitor first meets, and a design change has one source of record instead of eight copies. The package adds 120 KB of face to each of the harness's loopback responses, which are read once by one reader on one machine; the deployment keeps using its own `/fonts` copy and pays nothing.

The deployment copy is a real second copy. It is compared, not shared, and the comparison runs from the deployment's own suite, so a harness change that forgets the copy surfaces in that repository's tests rather than in a reader's browser.

The connector page keeps its en/zh outcome table, so a Chinese reader sees a Chinese outcome under a Latin wordmark that falls back to the system CJK face — the same behaviour as the coming-soon page and the client.

The legacy `templates/oauth.marko` — an inherited pink "Yello - Sign in" page that no route rendered — and `templates/billing-return.marko` are deleted with the billing route's Marko render.

## Testing

`packages/util/brand-page/tests/brand-page.spec.ts` pins both states, the scriptless form, the escaping, and the design the stylesheet states. The desktop sign-in pages, the web-app sign-in page (its host, flow and server-contract suites), the Slack login suite, the deployment's `brandPage.test.js` and its connector-callback suite cover each caller's copy, class, policy headers, and — for the deployment — the stylesheet sync check.
