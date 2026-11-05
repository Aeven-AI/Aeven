---
description: "Browser half of the desktop hand-off: the Available in Aeven Desktop dialog that a hosted web client opens instead of the Files, Browser, Terminal and Devices panes."
kind: "package-reference"
---

# @aeven/client-ui-desktop-handoff

English | [中文](README.zh.md)

## Summary

On a Host that has no access to the reader's computer, the right sidebar's Files, Browser, Terminal and Devices entries stay where they are and open one dialog: "Available in Aeven Desktop", with a download link and an "Open in Aeven Desktop" action. A prompt the Host refuses because the conversation works in a folder of a device that is not running it raises the same dialog. The desktop app never mounts this package, because there those entries are real panes.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## Use this package

A web composition that gives sessions no machine of their own mounts it: the ui-sidebar-select entries for `files`, `browser`, `terminal`, and `device` register a dialog opener instead of a pane, and `shell.overlay` hosts the dialog. The download page comes from the deployment's own site; a deployment that names none offers no download and keeps the hand-off action alone.

## Understand the implementation

`createHandoffStore()` is declared at register and holds whether the dialog is open and why. The sidebar entries and the conversation's `workspace/no-local-directory` refusal handler call `show(reason)`, the modal renders from the store, and every string lives in the `desktop-handoff` locale namespace.

## Further Exploration

- [Web app bundle](../../bundle/web-app/README.md)
- [Desktop app](../../../apps/desktop)

## Model Experience

None, as the package is a browser-side UI plugin layer that registers nothing model-facing.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **It cannot see whether Aeven Desktop is installed** — the browser has no way to ask, so "Open in Aeven Desktop" always shows the "not opened?" hint rather than adapting.
- **One reason per dialog** — a session with several local-only panes explains the first one it opened.
- **The download link is deployment copy** — a Host that serves no site URL shows no download action and no version.


### Dev Note

No invariant companion is published: the package's store and registrations are observed by its own specs, and it holds no relationship two independent observers could disagree about.
