---
description: "The `sync` Remote: the signed-in user's account sync status, turning sync on, joining from a new device, approving devices, and removing them."
kind: "package-reference"
---

# @aeven/api-sync-controller

English | [中文](README.zh.md)

## Summary

A Typert Remote over `ctx.sync` that acts only for the caller of the running request. `acceptJoins` answers join requests for `acceptJoinsMs` unless the add-device screen closes first. See the [account sync group](../../sync/README.md).

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
