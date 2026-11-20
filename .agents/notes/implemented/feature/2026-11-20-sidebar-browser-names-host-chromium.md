# Agent Note: The sidebar browser's open control stays visible and names the Host's Chromium

Status: implemented

English | [中文](2026-11-20-sidebar-browser-names-host-chromium.zh.md)

## Problem

The desktop sidebar browser's `open-in-chrome` control opens the page in the Host's Chromium, the remote-debugging profile that `chrome-devtools-mcp` drives. The control was hidden until the pointer was over the address field and was unmounted while the field had focus, so it disappeared as soon as the reader clicked into the address bar, and `browser_control open-in-chrome` failed while the field was focused. Its tooltip always said "Open in Chrome", although the Host launches Edge when Chrome and Chromium are not installed. The executable search found only Chrome, Chromium, Chrome Canary, and Edge, so Brave, Vivaldi, and Opera users had to set `executablePath` or `AVN_CHROME_PATH`.

## Decision

`ChromeRow` renders the control whenever the page has a URL, focused or not, with no hover rule; the address text always reserves the control's width. A `mousedown` on the control is prevented, so a draft being typed keeps focus and survives the click; the control opens the loaded page, not the draft.

`avn-browser-chromium` searches, after the existing candidates, the macOS, Windows, and `PATH` installs of Brave, Vivaldi, and Opera. A new `describe` remote returns `BrowserChromiumIdentity`, whose optional `name` is the product name looked up from the resolved executable's lowercased file name without `.exe` ("Chrome", "Chrome Canary", "Chromium", "Edge", "Brave", "Vivaldi", "Opera"), for a configured path as well as a found one. The sidebar browser calls `describe` once when the remote mounts and labels the control "Open in {browser}"; an unknown file name or a Host without a browser labels it "Open in browser". The copy exists in English, Chinese, and Spanish.

## Alternatives considered

- **Add the name to `status`.** `status` is sampled by `avn-tool-browser` for the model's report; adding a field there would change a model-visible report for a reader-facing label.
- **Show the control only while the field is not focused, but keep it mounted.** The reported failure was the control vanishing while the reader edited the address; any focus-dependent visibility repeats it.
- **Name the browser from the executable's directory or bundle metadata.** The file name identifies every supported browser on all three platforms without reading the bundle.

## Consequences

The control is always present on a loaded page, including for the agent's pointer. The tooltip names the browser a click reaches. A browser whose file name is not in the table still launches when configured, and is labelled generically. Opening still targets the shared debug profile at `<AVN_HOME>/runtime/chrome-profile`; handing the page to the reader's everyday browser is the separate proposal in issue #742.

## Testing

`pnpm run check:ci` and `pnpm run test` passed on the clean branch. No spec covers the label or the executable table; the label was checked by typecheck and build only.
