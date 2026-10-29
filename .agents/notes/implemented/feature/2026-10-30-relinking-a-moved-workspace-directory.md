# Agent Note: Relinking a moved workspace keeps its sessions

Status: implemented

English | [中文](2026-10-30-relinking-a-moved-workspace-directory.zh.md)

## Problem

A folder workspace is its directory: membership is decided by comparing a session's recorded canonical cwd with the workspace's path, and `bindDirectory` refused any record that already carried one. A reader whose project folder moved — renamed, reorganised, restored from a backup, or checked out again — had no way to point the workspace at the new directory. The old path kept naming a directory that was gone, every session recorded there stopped being a member, and the only repairs available were recreating the workspace (losing the grouping) or putting the folder back.

The row menu offered "Choose folder on this device", but only on a workspace that arrived from another device without a path, so the device that owned the folder had nothing to click at all.

## Decision

Choosing a workspace's folder is one action for both cases, and the registry's `bind(id, path)` dispatches on the record: a pathless record gains its first directory, a folder record is relinked to a new one.

A relink records the directory it leaves in a new durable `anchorPaths` list, most recent first, and every membership decision — `member()`, the prune inside `mutate()`, admission, startup re-admission, and adoption of a just-announced session — treats the current directory and every anchor as directories this workspace owns. The sessions recorded under the old path therefore stay attached instead of falling out of a workspace that moved out from under them.

`anchorPaths` is device-local. The account document continues to carry only a workspace's title and order, because a path means nothing on another machine; a relink on one device changes nothing for the other devices of the account, each of which chooses its own folder.

Resolution follows the same list: a session this device wrote resolves to its recorded directory, and when that directory sits under an anchor it is translated to the same place inside the workspace's current directory, so a session that worked in a subdirectory keeps that subdirectory across the move.

The row menu carries the action as **Choose workspace**, above Delete workspace, on every row that is not the built-in one — the same entry whether the workspace is pathless here or already folder-backed.

## Alternatives considered

**Rewrite the sessions' recorded directories.** It would make the header locally true again, but it destroys the portable record, needs a migration over existing logs, and rewrites immutable header metadata — and the other devices' copies would each have to do it again on arrival.

**Detach the sessions and refile them by the new path.** Membership is a comparison against a recorded path a session cannot change, so nothing would refile them: the workspace would simply empty, and the sessions would sit ungrouped with no route back.

**Recreate the workspace at the new directory.** The cheapest implementation, and what a reader had to do before: it loses the title, the position, and the archive state, and leaves the old record behind as a duplicate that names a directory nobody has.

**A separate "relink" verb beside `bind`.** The two differ only in which step of one lifecycle they perform, and a reader-visible distinction between "choose the folder for this workspace" and "choose the folder for this workspace" would be copy they cannot act on. The repository-facing name stays `bind`, documented for both cases.

## Consequences

- A moved project keeps its workspace, its title, its position, and its sessions; nothing is recreated and no session log is written.
- `anchorPaths` grows by one entry per relink and is never pruned; a device that relinks the same workspace repeatedly accumulates a short list of dead directories. Each entry costs one comparison per membership decision.
- A session recorded under a directory that is neither the current one nor an anchor is unaffected by this decision: it stays with whatever workspace names it, which for a move this device never learned about is still the stale binding.
- Two workspaces cannot claim the same directory through an anchor either, so a relink cannot silently steal another workspace's sessions.
