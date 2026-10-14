---
description: "The right sidebar's content selection: the per-session pill set over Browser, Terminal, Files, and Device, the full screen toggle, and the registry content plugins join."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-select

English | [中文](README.zh.md)

## Summary

The right sidebar shows a session's content as pills — Files, Browser, Terminal, and Device — and this package owns that selection: which pills a session has open, which one is shown, which kinds have a provider behind them, and whether the column is full screen. Content plugins join through `ctx.sidebarContent`, which answers a pane for the kind it registers; a kind with no provider still lists but cannot be picked. The open pills are remembered per session in browser storage. One package also seats the corner control that puts a session's column in full screen.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it wherever the right sidebar should offer content kinds. It needs `slots`, `locale`, and `layout`. `apply` starts the content registry as a plugin, registers `sidebar.right.body` and the frame's corner full screen toggle, and contributes its dictionaries; each content package then calls `ctx.sidebarContent.register(kind, Pane)` or `registerLauncher` from inside its own effect. The shown pills live under `avn.sidebar-right.surfaces` and the pre-pill single choice under `avn.sidebar-right.content`, one record per session.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the selection's own contract is not enough: the kinds that fill it and the column that draws it.

- [ui-sidebar-files](../ui-sidebar-files/README.md) — the Files pane.
- [ui-sidebar-device](../ui-sidebar-device/README.md) — the Device pane.
- [ui-sidebar-terminal](../ui-sidebar-terminal/README.md) — the Terminal pane.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — the column whose body this package occupies.
- [Slots reference](../../../docs/subsystems/slots.md) — the composition model behind the two seats this package claims.

-----

<a id="model-experience"></a>
## Model Experience

None, as the open pill set, the full screen state, and the content registry are browser viewing state; this package registers no tool, prompt section, or model-visible result.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define what the selection owns and what each pane owns.

- **No invariant companion** — No invariant companion is published because the package owns one in-process content registry plus its body and corner bindings, all released with the plugin fiber, and the registry's own `register` refuses a kind twice, so the pill set has no second authority to diverge from.
- **A pill's own state belongs to its pane** — the column remembers which pills are open and which is shown, never what a pane was showing.
- **A stored kind this build cannot render is dropped** — a session saved by a build with another kind opens on the selection instead of addressing a pane that is not there.
- **Full screen is per session and is not remembered** — switching sessions leaves full screen.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
