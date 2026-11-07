---
name: in-app-browser
description: Control the sidebar browser beside the session — open, visit, and read pages with the preview_* tools, press the pane's own toolbar, and capture what the user sees. A site the user names ("open linkedin") opens here; localhost, development, and debugging pages belong to Chrome DevTools. Use for screenshots of the pane, and when the pane is closed, refuses an automated read, or hides behind a consent wall.
---

# Control the in-app browser

The in-app browser is available in Electron. A request to open, visit, or read a website is this pane's: open it here and keep the task here, including a local address the person names. Development and debugging belong to the Chrome DevTools browser instead — a `localhost` or `127.0.0.1` page you are building, and any task that changes the code behind a page — and `preview_navigate` refuses such an address unless the person's own request names it, pointing at the `new_page` call to make instead. Serve that pane:
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
`preview_press`, `preview_scroll`, `preview_hover`, `preview_drag`,
`preview_select`, `preview_check`, `preview_read`, `preview_wait`,
`preview_content`, `preview_evaluate`, `preview_reload`, `preview_back`,
`preview_forward`, `preview_upload`, and `preview_sequence`. Take selectors from `preview_snapshot`'s
`interactiveElements` rather than coordinates, or use a locator: `text=Sign in`,
`role=button[name="Save"]`, `label=Email`, `placeholder=Search`, `testid=submit`;
join parts with `>>` and pick one of several matches with `>> nth=0`. A target
inside an iframe takes `frame` with the iframe's selector. Retry a call that failed with an
actionable error and corrected arguments; do not retry a page that answers
automated reads with a block page.

Read a whole article or document with `preview_content` (markdown by default;
`youtube_transcript` on a YouTube video) instead of scrolling through snapshots.
On an open Google Docs, Sheets, or Slides document, `preview_export_document`
saves it to the user's Downloads folder. `preview_console` shows the page's
console errors. A click that opens a JavaScript alert, confirm, or prompt returns
with the dialog; answer it with `preview_dialog` before anything else.

The pane's own toolbar is `preview_browser_control`: copy a screenshot to the
clipboard (`capture`), open the page in Chrome, hard reload, DevTools, zoom, and
appearance. The pointer presses each control, opening the three-dot menu when the
control lives there. Clearing cookies or cache asks the user first.

The browser can hold several tabs, each a Browser pill in the sidebar. `preview_tabs`
lists, opens, shows, and closes them; every other tool acts on the current tab.
`preview_history` searches pages the user visited in this browser (it asks first).
`preview_page_tools` lists the tools a page offers agents through WebMCP and invokes
one (it asks first); a page tool does the page's own work more reliably than clicks.

When a step is the user's to do — signing in, a captcha or verification code,
confirming a payment — call `preview_handoff` with the reason and one sentence
saying what to do. The user sees it as a modal; end your turn and continue when
they reply. Never type their credentials.

Use `preview_type` for a whole caption, including paragraph breaks; it inserts the text in one native action. Use `preview_upload` with absolute paths on the Electron computer and an explicit file-input selector, or the Upload button selector. The button's chooser is intercepted and answered within that upload call. When no selector is supplied, exactly one file input must exist. Remote uploads request approval naming the destination origin and files; localhost is exempt. Do not use clipboard paste, a temporary HTTP server, or a native file dialog for these uploads.

Use `preview_sequence` for known consecutive actions. Include `wait` actions for visible/enabled or hidden elements between page transitions, rather than sleeps. It stops at the first failure and returns the completed count and failed action index. Inspect the resulting editor or attachment before submitting; include a submission only when the user authorized it.

`preview_screenshot` returns the page's pixels to you. There is no `preview_open`:
ask the user to open the pane when `preview_status` reports no page.

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
- **The page is served from this machine.** A `localhost` or `127.0.0.1` page is
  an application under development, so it belongs to the Chrome DevTools browser.
  Open it there, not in this pane. Use the headless browser tools only when
  Chrome DevTools is unavailable, and say that the check ran in a headless copy.
- **A remote page refuses automated reads.** Inspect it in the selected pane.
  If the pane cannot perform the required operation, use external Chrome/CDP.
  Use headless browsing only when neither visible surface is available.
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
