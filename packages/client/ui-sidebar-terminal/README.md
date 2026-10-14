---
description: "The right sidebar's Terminal content kind: one interactive shell per pill, rendered with xterm.js and restyled with the application theme."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-terminal

English | [中文](README.zh.md)

## Summary

Each Terminal pill in the right sidebar holds one interactive shell that runs on the Host and is drawn by xterm.js with fit handling, the application's colors, and a cursor kept legible against the cell beneath it. The pill carries the shell's title, so several shells stay tellable apart, and a pill with no remembered command stops at a launch guide instead of guessing one. The shell outlives the pane: switching sessions detaches the view while the shell keeps running, and closing the pill closes the shell. Nothing about a shell is stored in the browser.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it in a web client that should offer shells in the right sidebar. It needs `sidebarContent`, `webTerminals`, `locale`, and `theme`. `apply` registers the `terminal` pane and its dictionaries inside effects on the plugin fiber, and the pane attaches one terminal view per pill through `ctx.webTerminals`. While a pane is mounted it holds its shell, so the Host keeps that shell alive; when the last pane for a pill unmounts, the hold is released. The live theme arrives as snapshots over `theme/change`, and each pane recolors its emulator and cursor from them.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the pane's own contract is not enough: the column it joins and the theme it follows.

- [ui-sidebar-select](../ui-sidebar-select/README.md) — the content registry this pane registers into.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — the column that renders a session's pills.
- [ui-theme](../ui-theme/README.md) — the theme snapshots the emulator and cursor follow.

-----

<a id="model-experience"></a>
## Model Experience

None, as the pane only attaches an xterm view to a shell that lives on the Host behind `ctx.webTerminals`; what the model sees of a shell is owned by the bash tool, not by this plugin.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define what the pane owns and what the Host owns.

- **No invariant companion** — No invariant companion is published because the pane owns one content-kind registration and the holds it takes while a pane is mounted, both withdrawn with the plugin fiber, while the shells, their scrollback, and their lifecycle are owned and reported by the Host terminal service whose answers the pane renders unchanged.
- **The pane keeps no terminal state** — it attaches to the shell the Host reports for its pill, and an unheld shell may be released after the configured unattended timeout.
- **A pill with no remembered shell stops at the launch guide** — no process starts until the reader picks a command.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
