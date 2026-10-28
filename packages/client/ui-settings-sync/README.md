---
description: "Settings → Sync: turn account sync on, add this device, approve new devices by code, and remove devices."
kind: "package-reference"
---

# @aeven/client-ui-settings-sync

English | [中文](README.zh.md)

## Summary

The Settings section over the `sync` Remote, refreshed by the forwarded `sync/status` and `sync/join-requests` events. It shows the six-digit code on both devices and approves only from the device whose add-device screen is open. Copy lives in the `settings.sync` dictionaries (English, Chinese, Spanish). See the [account sync group](../../sync/README.md).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as account sync moves stored data between devices and adds nothing to model requests. Imported conversations and memory reach a model only through the packages that already own them.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Shared with the group** — the limits of account sync are listed once in the [group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
