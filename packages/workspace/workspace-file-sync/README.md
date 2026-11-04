---
description: "File sync Consumer for workspaces: folder workspaces follow the account to its other devices."
kind: "package-reference"
---

# @aeven/workspace-file-sync

English | [中文](README.zh.md)

## Summary

A folder workspace opened on one device of an account syncs as one `ctx.fileSync` folder with the account's other devices. Each device publishes its file transport peer id in the account's `file-sync/peers` document, and shares folders with exactly the devices `ctx.sync` lists whose peer id is known. Each folder workspace's folder id, size, and location hint (its directory relative to the home directory) travel in `file-sync/folders`. A device that receives the workspace without a directory gives it one without asking: the hint under its own home directory when that directory does not exist or is empty, otherwise the workspace title under `root`, numbered when taken; it downloads at once when the download leaves `minFreeDiskRatio` of the disk free, and otherwise reports the `disk` failure. A Git work tree publishes no folder, and a folder workspace that becomes one withdraws its descriptor and stops syncing as a folder; [`@aeven/workspace-git-sync`](../workspace-git-sync/README.md) carries repositories. A folder whose workspace left the device stops syncing and keeps its files. The design is in the [workspace file sync Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.md). Each folder's transport status becomes its workspace's file status: `syncing` with the share already here until the folder first holds every file, `syncing` without progress while later changes arrive, `waiting` while no device that holds the files is reachable, and `failed` with the `folder` reason when the transport reports an error. A folder counts as complete once it holds at least as many files as its descriptor records, or when this device described it; a marker under `completeDirectory` keeps that across restarts, and only a complete folder records its size, so an empty folder that has not reached a peer yet never shrinks the descriptor.

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as the workspace files reach a model only through the file tools that already read the workspace directory.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Shared with the file sync group** — the limits of file sync are listed once in the [account sync group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because the synced documents and the provider's folders are reconciled on every change rather than observed independently.
