---
description: "The Æven brand page every browser round trip lands on: one centred wordmark, the line that fits what just happened, and the mark-and-spinner cover for pages that wait."
kind: "package-reference"
---

# @aeven/brand-page

English | [中文](README.zh.md)

## Summary

`avn-brand-page` owns the page a reader sees when they leave the application shell for one browser round trip — a sign-in handoff, a finished sign-in, a connector consent, a billing return — and come back. One renderer draws the coming-soon page's lockup for all of them: the sheet, the grain, and the Æven wordmark, with one line stating what happened and one quieter line stating what to do next. The package owns the document, the stylesheet, and the face; each caller owns its copy and its response headers.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

### When to use it

Use `brandPageHtml` whenever a request answers with a page a person reads rather than a redirect or a machine-readable body: a provider handoff, the landing after a consent, a return from a payment. A page inside the application shell is the shell's, not this package's.

### Entry point

Render a page with the line it reports and, optionally, the direction under it:

```ts
import { brandPageHtml } from '@aeven/brand-page'

const page = brandPageHtml({
  note: 'Signed in.',
  hint: 'You can close this window.',
  title: 'Signed in — Æven',
})
```

A page that is on its way somewhere else renders in the waiting state and hands the destination to the document, so the cover is what the reader sees until the browser leaves:

```ts
import { brandPageHtml } from '@aeven/brand-page'

brandPageHtml({ state: 'waiting', note: 'Continuing to sign in…', redirect: 'https://example.com/continue' })
```

`scripted: false` renders the same design for a page served under a policy that refuses script. The stylesheet then reveals the lockup on its entrance instead of on the font gate, and neither a redirect nor a reveal script is emitted.

### Options

| Option | Effect |
|---|---|
| `note` | The line under the wordmark: what just happened. |
| `hint` | The quieter line under it: what the reader does next. Omitted when absent. |
| `state` | `result` (default) settles straight to the wordmark; `waiting` holds the mark and spinner first, then lifts the cover. |
| `title` | The tab line. Defaults to `Æven`. |
| `lang` | The document's `lang`. Defaults to `en`. |
| `redirect` | Where a scripted page leaves as soon as it has painted. |
| `scripted` | Whether the document runs its font gate and its redirect. Defaults to `true`. |

## Understand the implementation

### The design is the coming-soon page's

`BRAND_PAGE_CSS` is the stylesheet the marketing site's coming-soon page uses — the same `#f2f2f2` sheet, the same turbulence grain, the same wordmark scale (`clamp(3.25rem, 11vw, 10rem)`, weight 520), the same `settle` keyframe — extended with the two lines under the wordmark and with the result state's timing. A page that waits keeps the coming-soon intro: the cover lifts 780ms after the face is in, and the wordmark arrives 1000ms in.

### Nothing is fetched

The face ships beside the module (`assets/google-sans-flex-latin-wght-normal.woff2`) and is inlined into every document as a data URI, so a page served on a loopback port that knows no asset routes still sets the wordmark in the product's type. The tab icon is an inline data URI for the same reason. A rendered page opens no connection of its own.

### The gate, and the pages that cannot run it

A scripted page marks itself `fonts-loading` before first paint and swaps to `fonts-ready` once `document.fonts.load` resolves for the two weights the lockup uses, with a 3.5s budget. That swap is what starts the intro, so no glyph is ever drawn in a fallback face. A page under a policy that refuses script carries neither class; the stylesheet's resting state is the type without the cover, and the entrance animations are keyed on `:not(.fonts-loading)` so they run on load.

### The deployment keeps a copy

The Aeven API serves its own connector and billing pages from a CommonJS copy of this design. The stylesheet between the `// <brand-page-css>` markers in `src/page.ts` is the source of record; `scripts/brand-page-css.mjs --check` in that repository fails when its copy drifts, and its unit suite runs the check when a harness checkout is beside it.

## Further Exploration

- [The Web capability group](../../client/README.md) for the shell these pages sit outside of.
- [docs/architecture.md](../../../docs/architecture.md) for where host packages sit in the composition.

<a id="dev-note"></a>
## Dev Note

No runtime invariant companion is published: the page is a pure render of its arguments, so the package owns no durable event stream or independent observable relation to check.

### Testing

`tests/brand-page.spec.ts` pins both states, the scriptless form, the escaping, and the stylesheet's stated design. Callers pin their own copy: the desktop sign-in pages, the web-app sign-in page, and the Slack loopback page each assert the class, the message, and the inlined face.

<a id="model-experience"></a>
## Model Experience

### Nothing model-facing

#### What the model sees

Nothing. `brandPageHtml` renders documents a browser reads — a sign-in handoff, a finished sign-in, a connector consent, a billing return — and registers no prompt section, tool, session event, or result.

#### Token effect

None. No rendered page reaches a model request, so the pages of `brandPageHtml` contribute no token.

#### KV Cache effect

None. Nothing here enters a request prefix, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- The copy is the caller's, in the caller's language: the deployment's connector page carries its own English and Chinese table, and the harness pages pass labels from their own locale. The package translates nothing.
- The face is Latin-only, so a Chinese `note` falls back to the system CJK face while the wordmark keeps Google Sans Flex.
- The deployment copy is a second physical copy of the stylesheet. It is compared, not shared, because the two repositories build independently.
