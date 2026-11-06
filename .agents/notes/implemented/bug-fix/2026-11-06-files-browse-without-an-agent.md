# Agent Note: Files browses a session without starting its Agent

Status: implemented

English | [中文](2026-11-06-files-browse-without-an-agent.zh.md)

## Problem

Account sync keeps every idle conversation as a replica on each device and claims it back when a turn starts. The Files explorer's `workspaceFiles` Remote took an `Agent` parameter, so every listing, preview, and search resumed the session's Agent first. Resuming a replica is refused (`SessionPersistenceReadOnlyError`), so Files answered "replicated from another device; fork it to continue" for every idle synced conversation, on desktop and on the hosted Host alike.

## Decision

`list`, `read`, and `search` take the session id. A session with a live Agent here resolves its root through `sessionWorkspaceRoot` as before. Any other session is observed through `sessionQuery`, refused as absent when the acting caller does not own it, and resolved through `WorkingDirectoryService.observed(header, projection)`. That method shares one placement routine with `local(session)`: the logged `workingDirectory` projection, this device's workspace binding, and, on a Host without folders, the managed account folder. The wire is unchanged, because the `agent` lookup already carried the session id.

## Alternatives considered

**Claim the session when Files opens:** browsing would move the session's running device and fail while another device runs a turn.

**Repeat the skill catalog's cold-path resolution in the Remote:** that copy omits the managed account folder, so hosted replicas would list the wrong root; one routine in the owning service keeps live and observed answers identical.

## Consequences

The explorer reads replicas without writing to them or starting work. The skill catalog keeps its own cold-path copy of the placement rule and can move to `observed` separately. The `sidebar_files` model tool still runs inside a live Agent and is unchanged.
