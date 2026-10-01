---
name: in-app-browser
description: Control the browser beside the session — read and drive the page with the preview_* tools, press the pane's own toolbar, and capture what the user sees. Use for web verification, for screenshots of the pane, and when the pane is closed, refuses an automated read, or hides behind a consent wall.
---

# Control the in-app browser

The browser beside the session is the pane the user is watching. Serve that pane:
read it, drive it, capture it, and say plainly when it cannot be driven. Resolve
every relative path below against the base directory reported in
`<skill_resources>`.

## Pick the surface

| Need | Surface |
| --- | --- |
| Read or interact with the page | the `preview_*` tools |
| Pixels of the pane | `scripts/pane.mjs capture --out <file>` |
| The pane's chrome: back, forward, reload, address, zoom, options | `scripts/pane.mjs click "<label>"` |
| A page that refuses automated reads, or needs the user's own session | the escalation order under [When the pane cannot serve](#when-the-pane-cannot-serve) |

The `preview_*` tools are the supported surface and the only one that leaves the
pane where the user put it. The script covers the two things the tools do not do:
capturing pixels and pressing the pane's toolbar.

## Read and drive the page

Call `preview_status` first. It reports the page beside the session, the Chromium
this Host runs, and which of the two to drive.

Then `preview_navigate`, `preview_snapshot`, `preview_click`, `preview_type`,
`preview_press`, `preview_scroll`, `preview_evaluate`, `preview_reload`,
`preview_back`, and `preview_forward`. Take selectors from `preview_snapshot`'s
`interactiveElements` rather than coordinates. Retry a call that failed with an
actionable error and corrected arguments; do not retry a page that answers
automated reads with a block page.

There is no `preview_screenshot` and no `preview_open`: capture through the pane
as below, and ask the user to open the pane when `preview_status` reports no page.

## Capture what the user sees

```sh
node scripts/pane.mjs capture --out .artifacts/pane.png
node scripts/pane.mjs list
node scripts/pane.mjs click "Copy screenshot"
```

`capture` attaches to the pane's own target and writes a PNG. `list` prints the
targets the script can reach, for when `capture` finds no pane. `click` presses a
toolbar control by its label: `Back`, `Forward`, `Refresh`, `Address`,
`Open in Chrome`, `Copy screenshot`, `More`.

Look at the file with `read_image` before reporting it, and embed it in the reply
by absolute path. The pane's zoom decides what a capture contains — the page
renders at pane width divided by zoom in CSS pixels, so one address lays out
differently at 80% and at 125%. Read the current zoom from the pane's
**More → Zoom** before comparing two captures. `references/cdp-surface.md` has
target discovery, the click-versus-coordinates rule, the verification probes, and
the two properties that make this route a last resort.

## The pane belongs to the user

Navigating, clicking, reloading, or zooming moves what the user is watching. Do
it when the task needs it, and say what you changed. Ask `preview_status` again
whenever the pane may have moved under you. Never type credentials into a page;
stop and ask the user to sign in instead.

## When the pane cannot serve

- **No page is open.** `preview_status` names the next step. Ask the user to open
  the browser from the right sidebar (Browser) rather than reporting that no
  browser exists.
- **The page refuses automated reads.** Escalate in the order the harness
  documents: the headless browser tools open no window, and a page that refuses
  those too is read in the Chrome attached to the user's own browser, which does
  open one.
- **A consent wall or modal covers the page.** The overlay usually lives in a
  shadow root, so a top-level `querySelectorAll` finds nothing and the page looks
  empty. Enumerate elements for one carrying a `shadowRoot`, read its text, then
  click the accept or reject control inside it and report which one you pressed:
  consent is the user's decision, not a detail of the task.
- **The pane sits outside the window.** A pane at an `x` past the window width, or
  behind a container at `opacity: 0`, never receives a coordinate click. Click
  through the DOM instead, and verify by state rather than by the absence of an
  error.

## Verify before reporting

The pane answers a capture, a click, or a status call with state you can check:
the file exists and shows the page, `performance.timeOrigin` moved after a
reload, the address bar carries the URL you navigated to, the consent cookies
exist after the overlay is dismissed. A tool call that returned without an error
is not evidence that the browser did anything.
