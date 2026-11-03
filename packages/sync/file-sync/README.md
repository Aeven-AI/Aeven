---
description: "Service Definition for file sync (`ctx.fileSync`): folders kept the same on every device of one account, peer to peer."
kind: "package-reference"
---

# @aeven/file-sync

English | [中文](README.zh.md)

## Summary

The `ctx.fileSync` Service Definition. A Consumer shares a folder under a random id with the account's peers (`share`, `unshare`), lists which devices those are (`setPeers`, with each device's `peerId`), and reads each folder's state and size (`status`); `file-sync/folder` tells listeners a folder's status changed. The provider owns the transport and its process, and the Consumer decides which folders travel and where they live. The design is in the [workspace file sync Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.md).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as file sync moves files between devices and adds nothing to model requests.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Shared with the group** — the limits of file sync are listed once in the [group README](../README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because the Service Definition declares the seam, and the provider owns every value a listener could compare.
