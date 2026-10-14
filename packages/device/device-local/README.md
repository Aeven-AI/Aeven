---
description: "The local device host: runs expo-device-hub and agent-device on the machine Aeven runs on, for its iOS Simulators and Android Emulators."
kind: "package-reference"
---

# @aeven/device-local

English | [中文](README.zh.md)

## Summary

This is the device host that is the machine Aeven runs on: it supervises expo-device-hub as a loopback child, answers the hub JSON routes the device service calls, and starts the agent-device daemon once the user grants model access. Both are pinned npm tools installed on demand under the device tools directory and run with the host's Node rather than through an ephemeral npx cache, so the version the model's instructions describe is the one that runs. Platform availability comes from probing this machine's Xcode and Android SDK, so a machine with no simulator toolchain never installs or starts anything.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it beside `@aeven/device` on any host whose own simulators and emulators should be reachable; it injects `devices` and registers one host under the local host id. `Config` supplies the pinned `hubVersion` and `agentVersion`, an optional `toolsDir` and `stateDir` root, the `nodePath` and `npmPath` the tools run and install with, and the install, readiness, restart, and command deadlines. The service decides when a host starts, so this package installs and spawns nothing until the user enables device support and, for the agent daemon, model access.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the host's own contract is not enough: the service it joins, the pane that shows what it streams, and the composition that mounts it.

- [device](../device/README.md) — the device seam this host registers into.
- [ui-sidebar-device](../../client/ui-sidebar-device/README.md) — the pane that renders the streamed screens.
- [avn-web-app bundle](../../bundle/web-app/README.md) — the composition that mounts this row.

-----

<a id="model-experience"></a>
## Model Experience

None, as the host only installs and starts the tools behind `ctx.devices`; the model's device tools and their results are owned by the tool package that calls that service.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define what the host does and what it refuses to do.

- **No invariant companion** — No invariant companion is published because the host owns one supervised child per tool and reports readiness only through the device host contract, which the device service records and publishes, so the plugin keeps no state of its own that a separate observer could compare with that record.
- **Installs happen on demand and need the registry** — the pinned hub and agent versions come from npm the first time device support is enabled, and a failure to install is reported as the host's state instead of being retried silently.
- **Availability is probed, not provisioned** — a missing Xcode or Android SDK marks that platform unavailable with its reason rather than failing the host.
- **The hub is restarted after a crash** — the service reports the restart, so a stream breaks and reconnects instead of the host failing permanently.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
