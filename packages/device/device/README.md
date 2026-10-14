---
description: "The iOS Simulator and Android Emulator seam: device hosts, per-session device sessions, the state stream the sidebar pane renders, and the authenticated hub proxy."
kind: "package-reference"
---

# @aeven/device

English | [中文](README.zh.md)

## Summary

This service owns which session is looking at which simulator or emulator, so the model's device tools, the right sidebar's Device pane, and the stream proxy all read one state. Hosts join through `ctx.devices`; the shipped composition registers the machine Aeven runs on. Nothing installs or starts until the user enables device support in the pane, and model control needs a second, separate consent. State reaches readers as one revisioned snapshot over the `device` Remote, and a device screen reaches the browser only through this service's authenticated proxy of the host's hub.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it in a host that should offer simulators and emulators, and add one host provider per machine that runs them. It reads the `device` settings namespace for its three consent switches and, when `webServer` and `connection` are present, mounts the hub proxy at `hubMount` so no browser talks to the hub directly. `Config` supplies `hubMount`, the request, boot, and screenshot deadlines, an optional `stateDir`, and the consent defaults; `registerHost` is how a provider such as `device-local` joins, and `agentTarget` is what points the model's agent-device launcher at one device.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the service contract is not enough: the local host, the pane that renders the state, and the composition that mounts both.

- [device-local](../device-local/README.md) — the host that runs the hub and agent daemon on this machine.
- [ui-sidebar-device](../../client/ui-sidebar-device/README.md) — the pane that renders the state stream.
- [avn-web-app bundle](../../bundle/web-app/README.md) — the composition that mounts this row and the local host.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through avn-tool-device: the model's `device_*` calls invoke this service's device sessions and read the state it publishes, while that package owns the schemas, guidance, and results the model actually reads.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define what the service owns and what it leaves to a host.

- **No invariant companion** — No invariant companion is published because every change to the hosts, their readiness, the discovered devices, and the per-session device sessions passes one serialized lifecycle and one publish point that bumps the revision, and readers only ever receive that snapshot over `device.watch`, so no second copy exists for an observer to compare with it.
- **Consent gates the whole service** — with device support off, reads answer the disabled state and no hub starts; with model access off, a device the model opened cannot exist.
- **A device outlives the session that opened it** — closing a session's device session detaches it, and only an explicit shutdown powers the device off.
- **A failing host is state, not an exception** — discovery and start failures are reported inside the state with their reason, and `retryHost` is the only retry.
- **Another account's sessions are withheld** — a caller receives the machine's devices but only its own device and booting sessions.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
