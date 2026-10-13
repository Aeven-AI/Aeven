# The pane over CDP

Read this when `preview_*` cannot do the job: pixels, the toolbar, or a page the
tools cannot read. This route drives the application's own window, so treat it as
a last resort and verify everything it reports.

## Two targets, one pane

The pane is a `<webview>` inside the application window; both are Chrome DevTools
Protocol targets on one debug port.

| Target | What it is | What you get from it |
| --- | --- | --- |
| `webview` | the page itself | pixels, `location`, script evaluation inside the page |
| `page` | the application window that hosts the pane | the pane's DOM: toolbar controls, address value, the pane's box |

A capture taken on the `webview` target is the page; a click on the `page` target
reaches the toolbar. Neither is the `preview_*` tool surface, which answers over
the client that holds the session.

## Find the port and the target

The app listens on `127.0.0.1:9222` (its Node inspector on `9229`). `pane.mjs`
probes for it; to check by hand:

```sh
lsof -nP -iTCP -sTCP:LISTEN | grep -iE 'electron|chrome|chromium'
curl -s http://127.0.0.1:9222/json/list
```

Match the pane by `type: "webview"` **and its URL**. The list also holds ad
iframes and workers; a stored target id goes stale on every restart, so list
again instead of reusing one.

## Click with the DOM, never with coordinates

The pane is routinely parked outside the window: measured `innerWidth: 1728` with
the pane at `x: 1728` and its container at `opacity: 0`. Dispatched mouse events
at those coordinates reach the document and never the control. `pane.mjs click`
evaluates `el.click()` in the application window instead, which fires the control's
handler wherever the pane sits.

## The toolbar

Each control carries a stable `aria-label`; the labels are `Back`, `Forward`,
`Refresh`, `Address` (an `input` holding the current URL), `Open in Chrome`,
`Copy screenshot`, and `More`. `More` opens a `[role="menu"]` portal with
`Hard reload`, `Appearance`, a `Zoom` stepper, `Clear cache`, `Clear cookies`, and
`Open DevTools`.

Verify each control by state, not by the absence of an error:

| Control | What proves it worked |
| --- | --- |
| `Refresh` | `performance.timeOrigin` in the `webview` target changed while the URL did not |
| `Back` / `Forward` | the `webview` target's `location.href` moved; restore the original address afterwards |
| `Copy screenshot` | clear the clipboard, click, then read it: the PNG appears only after the click |
| `More` | `document.querySelector('[role="menu"]')` exists and lists the six entries |

`Address` is a controlled input: assigning `.value` does not update the
application's state. Type into it with real key events, or navigate with
`preview_navigate`, which is the supported route.

## Zoom decides the viewport

The pane has its own zoom, so the page does not render at the pane's width: the
guest viewport is **pane width ÷ zoom**, and its device pixel ratio is
**2 × zoom**. A 784 px pane measured at 80% renders 980 CSS pixels at dpr 1.6; at
125% it renders 627 at dpr 2.5. One address therefore lays out as one column at
one zoom and two columns at another. Read the current value from **More → Zoom**
before comparing two captures of the same page.

## A page that looks empty

A consent wall or a modal is often a web component: the markup lives in a shadow
root, and a top-level `querySelectorAll` finds no button at all. Enumerate
elements for one carrying a `shadowRoot`, read `shadowRoot.textContent`, then
click the accept or reject control by its id inside that root. Report which
control you pressed, and check the outcome in cookies rather than in the text,
which stays in the DOM after the click.

## Why this is a last resort

- It needs the application to expose a debug port, so it works on a development
  or desktop build and can be absent in a deployment.
- It drives the user's own window rather than the session's tool surface, so a
  stray click lands in the interface they are using.
- It reports the page, not the session: nothing here proves what the model-visible
  tools would have seen.
