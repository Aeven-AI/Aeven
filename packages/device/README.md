---
description: "The device package group: the ctx.devices seam, the local host that runs the simulator toolchain, and the model-facing device tools."
kind: "package-group"
---

# device/ — iOS Simulators and Android Emulators

English | [中文](README.zh.md)

## Summary

The device group lets a session see and drive the iOS Simulators and Android Emulators on the machine Aeven runs on, from the model's `device_*` tools and from the right sidebar's Device pane. Hosts join through `ctx.devices`, and the shipped composition registers this machine. Nothing installs or starts until the user enables device support in the pane, and model control is a second, separate consent. Three packages split the family: the service that owns sessions and consent, the host that runs the toolchain, and the tools.

## Table of Contents

- [Packages](#packages)
- [Related documentation](#related-documentation)
- [Dev Note](#dev-note)

<a id="packages"></a>
## Packages

The seam package owns device sessions and consent; the other two packages provide the host that runs the toolchain and the tools the model calls.

| Package | Role |
|---|---|
| [`device/`](device/README.md) | Owns `ctx.devices`: host registration, per-session device sessions, the consent switches, and the authenticated hub proxy a device screen reaches the browser through |
| [`device-local/`](device-local/README.md) | The host that is this machine: supervises `expo-device-hub` and the `agent-device` daemon for the local simulators and emulators |
| [`tool-device/`](tool-device/README.md) | The model-facing `device_list`, `device_open`, `device_screenshot`, and `device_close` tools |

<a id="related-documentation"></a>
## Related documentation

- [Devices subsystem](../../docs/subsystems/device.md) — the `ctx.devices` operations, device sessions, host readiness, and the consent switches.
- [Generated tool catalog](../../docs/tool-catalog.md) — the `device_*` schemas the model receives.
- [Generated configuration catalog](../../docs/config-catalog.md#aevendevice) — every accepted config field for the seam and the local host.
- [Capability seams](../../docs/glossary.md#capability-seam) — the Service Definition, Service Provider, and Consumer roles this group is built from.

<a id="dev-note"></a>
## Dev Note

None.
