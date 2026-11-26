# Agent Note: two holders of a repository replaced each other's description without end

Status: implemented

English | [中文](2026-11-26-one-holder-describes-a-synced-repository.zh.md)

## Problem

On 2026-11-26 the desktop Host used 10–11% of a CPU core while idle and the hosted Host 23%. Both held workspace `808f70b3…`, a 725 MB repository on the desktop and a managed copy on the hosted Host. `workspace-git-sync` kept one description per repository in the account's `workspace-git/repositories` document, and every holder wrote its own on each pass. A description carries the location hint and the size, which differ on every device, so each holder found the other's description different, replaced it, and the replacement started the other holder's next pass. Three faults followed from that.

- Each pass on the desktop ran about 11 Git commands per repository and wrote and removed a checkpoint staging directory, about once a second.
- A `Y.Map` entry that two devices replace in turn leaves one deleted item per write that no merge combines. The document reached 4.7 MB, each device queued a snapshot of it every `snapshotAfter` frames, and the account's `sync.db` reached 1.1 GB of which 73% was free pages.
- The hosted Host published `http://127.0.0.1:3128/git/github.com/…` as the remote. `git remote get-url` applies `url.<base>.insteadOf`, and that Host routes Git through a local proxy; the repository's configuration held the real URL.

## Decision

- A description records the device that wrote it. A holder describes a repository only when it has no description, when it wrote the current one, or when the describing device is no longer a holder.
- The remote is read with `git config --get remote.<name>.url`, which applies no rewrite.
- The document is `workspace-git/repository-holders`, and each device retires `workspace-git/repositories`. A Yjs document cannot drop the deleted items, and a build that predates this note keeps writing descriptions without a device into the first document, where builds with the rule would have to treat them as replaceable.
- `SyncStore.reclaim` rewrites a store file without its free pages at open when they exceed `reclaimFreeRatio` (default 0.5) of it.

## Alternatives considered

- **Compare descriptions by remote only.** Rejected: two holders with different remotes for one workspace, such as a fork, would replace each other the same way.
- **One description per device.** Rejected: readers need one remote, branch, hint, and size to place a repository, and would have to pick among several.
- **Reject loopback hosts in `publicRemote`.** Rejected as the fix: the rewritten URL is wrong for any proxy address, and the configured URL is right for all of them.

## Consequences

The branch, hint, and size are those of the describing device and change only when that device runs a pass; a holder that changes its remote does not publish it while another holder describes the repository. A device on an earlier build and a device on this build keep separate repository lists until both run this build. The relay keeps the first document.
