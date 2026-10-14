---
description: "The right sidebar's Device content kind: live iOS Simulator and Android Emulator screens with touch, keys, hardware buttons, and device actions."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-device

English | [中文](README.zh.md)

## Summary

The Device pill shows the simulators and emulators on the registered device hosts: the machine's device list first, then the opened device's live screen with touch, keyboard input, hardware buttons, rotation, a settings read-back, and the action panel its platform supports. It streams through the Host's authenticated hub proxy and decodes the hub's own wire formats, using WebCodecs for H.264 where the browser has it and the hub's MJPEG endpoint where it does not. The pane and the model read one state: a device the model opens appears in the pane of the session that opened it. Nothing installs or starts until the user enables device support.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it in a web client whose sidebar should show devices. It needs `sidebarContent`, `remote`, and `remote.device`. `apply` registers the `device` pane and its dictionaries inside effects on the plugin fiber, and every pane shares one reconnecting subscription to the Host state through `device.watch`; the pane sends `device.list`, `device.open`, `device.close`, `device.shutdown`, `device.detail`, `device.action`, `device.configure`, and `device.retryHost`, and a session the Host reports as newly holding a device opens that session's Device pill.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the pane's own contract is not enough: the state it renders and the column it joins.

- [device](../../device/device/README.md) — the service that discovers, opens, and streams devices.
- [ui-sidebar-select](../ui-sidebar-select/README.md) — the content registry this pane registers into.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — the column that renders a session's pills.

-----

<a id="model-experience"></a>
## Model Experience

None, as the pane only renders the device state stream and sends `ctx.devices` commands through the Client Remote; the model's device tools and their results are owned by the tool package that calls the same service.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define what the pane shows and what the device service owns.

- **No invariant companion** — No invariant companion is published because the pane owns one content-kind registration and its dictionaries on the plugin fiber, and every value it renders is the device service's published snapshot delivered over `device.watch`, so the client keeps no second copy of the state an observer could compare against it.
- **Video and input are separate connections** — the pane states when the stream is up while touches and keys have not reached the device yet.
- **Device support and model access are separate consents** — with support off the pane offers the setup flow, and with model access off a device the model opened cannot exist.
- **Closing a pill does not power a device off** — the power action on the control row shuts the simulator or emulator down.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
