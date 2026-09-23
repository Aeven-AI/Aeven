# Agent Note: Workspace deletion archives its sessions

Status: implemented

English | [中文](2026-09-23-workspace-deletion-archives-sessions.zh.md)

## Problem

Deleting a Workspace left its Sessions under Ungrouped. The user who deleted the project wanted those Sessions gone from the sidebar, and Ungrouped showed them in a bucket with no name and no owner.

## Decision

`WorkspaceRegistry.delete(id)` appends the deleted Workspace's member Sessions to `archivedSessionIds` in the same registry-state write that removes the id from `workspaceIds` and records the pending delete marker. Already archived ids keep their position. The table-write rollback restores the prior archive set together with the prior order, and startup recovery keeps the archive set the marker write committed. The Host feed publishes the existing `archived` increment before `remove`, so clients need no new frame. Folders, files, and Session logs are still never touched ([registration deletion](2026-07-27-workspace-registration-deletion.md)).

## Alternatives considered

**Move the Sessions into the built-in Chats Workspace.** Rejected: Chats has no directory and refuses Sessions whose header records a cwd, and a Session resumed from Chats would still run in the deleted project's folder.
