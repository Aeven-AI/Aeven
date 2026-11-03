---
description: "Git Consumer for workspaces: repository workspaces follow the account to its other devices."
kind: "package-reference"
---

# @aeven/workspace-git-sync

English | [中文](README.zh.md)

## Summary

A workspace whose directory is a Git work tree follows the account to its other devices as a repository. Each device that holds one publishes, in the account's `workspace-git/repositories` document, its remote URL without credentials, its checked-out branch, its location hint (the directory relative to the home directory), and its size, and records itself as a holder. A device that receives the workspace without a directory gets it without asking:

1. **Existing checkout.** A checkout whose remotes include the same repository is bound without downloading. The search compares remotes by host and path, so the SSH and HTTPS forms match. It looks first at the hinted directory, then at the siblings of other workspaces' directories, then up to `discoveryDepth` levels under `discoveryRoots`. It reads only each candidate's Git configuration and gives up after `discoveryTimeoutMs`.
2. **Clone.** Otherwise, when the size fits `prefetchMaxBytes` and leaves `minFreeDiskRatio` of the disk free, the device clones into a directory picked the same way folder workspaces are placed. The clone includes submodules and switches to the published branch. It uses this device's own Git credentials and never prompts. Git LFS objects are fetched when Git LFS is installed.
3. **Copy from a device.** When the clone fails, or the repository has no remote, the device copies it from another device that holds it. One holder, picked through a lease, writes a bundle of every ref into a transfer folder that `ctx.fileSync` shares with the requesting device alone. The requester clones from the bundle and sets `origin` to the published remote, or removes it.

Git comes from `PATH` or each platform's standard install locations. When a repository arrives on a device without Git, the platform's installer runs once: Homebrew or Apple's Command Line Tools dialog on macOS, winget on Windows. On Linux, where installing needs root, the warning names the distribution's command.

Environment files are files Git ignores whose names match `envFiles.patterns`, such as `.env`, outside ignored directories and within the size and count limits. They travel encrypted in the account's `workspace-git/env/<workspace id>` document. A device writes one only where no file of that name exists, so a local value is never replaced, and writes only paths that match the patterns. A device publishes a file again when it changes locally.

A failed attempt waits `retryMs`, and a pass every `passIntervalMs` publishes changed environment files and retries. The design is in the [workspace file sync Agent Note](../../../.agents/notes/proposed/architecture/2026-11-03-workspace-file-sync.md).

## Table of Contents

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

<a id="model-experience"></a>
## Model Experience

None, as a repository reaches a model only through the file, shell, and version-control tools that already read the workspace directory.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Only committed and pushed work travels.** Uncommitted changes and commits absent from the remote stay on the device that made them until the work-state checkpoints the note plans for phase 3; a copy from a device carries its commits but not its work tree changes.
- **The agent's own Git still uses `PATH`.** The version-control provider runs `git` from `PATH`, so a Git that only the standard locations hold, such as one just installed, is not yet the agent's.
- **No LFS objects through a copy.** A repository copied from another device carries no Git LFS objects; they are fetched from the remote once it is reachable.
- **Shared with the file sync group** — the other limits of file sync are listed once in the [account sync group README](../../sync/README.md#known-limitations-and-deferred-work).

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No runtime invariant companion is published because the synced documents and the local checkouts are reconciled on every change rather than observed independently.
