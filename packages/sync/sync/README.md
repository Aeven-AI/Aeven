---
description: "Service Definition for account sync (`ctx.sync`): per-account encrypted documents, streams, devices, and joining."
kind: "package-reference"
---

# @aeven/sync

English | [中文](README.zh.md)

## Summary

The `ctx.sync` Service Definition. Consumers open a document by logical name in an account's vault and edit its Yjs state, append to and read streams, list and remove devices, and drive joining: `createVault`, `vaultExists`, `join`, `acceptJoins`, `joinRequests`, `approveJoin`, and `rejectJoin`. `sync/status`, `sync/join-requests`, and `sync/document` tell listeners when an account's status, pending join requests, or a document changed. `tests/memory.ts` is an in-memory network of devices for Consumer tests. See the [account sync group](../README.md).

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

- **Shared with the group** — the limits of account sync are listed once in the [group README](../README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
