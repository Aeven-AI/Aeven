---
description: "The model-facing device_* tools: how a session lists, opens, screenshots, and closes the iOS Simulators and Android Emulators beside it."
kind: "package-reference"
---

# @aeven/tool-device

English | [中文](README.zh.md)

## Summary

`avn-tool-device` registers four tools on `ctx.tools`: `device_list`, `device_open`, `device_screenshot`, and `device_close`. Each reads `ctx.devices` at call time, so the package holds no device state of its own: `device_open` boots or attaches a device, records it for the calling agent, and returns the `agent-device` executable pinned to that device, and every later step of driving it — taps, typing, installs, logs — runs through that CLI rather than through a tool per operation. All four tools register on every host; a deployment without `ctx.devices`, with device support switched off, or without agent access answers with its own fixed sentence instead of hiding the tool.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

### The `device_*` tool schemas

#### What the model sees

The four entries in the generated [tool catalog](../../../docs/tool-catalog.md#aeventool-device), with their parameters. `device_open` returns the opened device, the `agent-device` command, and the quick-start text the model drives the device with; `device_screenshot` returns one summary line and, on a route whose model accepts images, the captured PNG as an attachment.

#### Token effect

Fixed while the tools are visible: four entries with their descriptions, independent of how many devices or hosts exist.

#### KV Cache effect

Prefix-stable while the visible tool set is unchanged; each call appends one result.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Driving a device is not a tool** — taps, typing, installs, and logs go through the `agent-device` CLI that `device_open` returns, so the model needs a host that can run it.
- **No invariant companion** — No runtime invariant companion is published because each tool reads `ctx.devices` at call time and the package keeps no session, pane, or screenshot state of its own; the device bookkeeping these tools act on is owned by `@aeven/device`.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
