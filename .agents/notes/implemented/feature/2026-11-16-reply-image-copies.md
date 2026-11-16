# Agent Note: Local Images in Replies Are Stored and Synced

Status: implemented

English | [中文](2026-11-16-reply-image-copies.zh.md)

## Problem

A reply on chat.aeven.io showed two local previews, `~/Documents/Aeven/Presentations/Aeven-Presentation-preview.png` and `Aeven-for-Business-preview.png`. The first rendered, and the second showed "image unavailable". The first had a stored copy only because the Turn had called `read_image` on that path: the Client's turn-local `read-images` index maps a path `read_image` read to its attachment, and session sync carries every attachment an event references to the account's other devices, the hosted Host included. The Turn never read the second file, and the Client had no other source for a path outside the workspace: `workspaceImagePath` returned nothing for it, and the desktop that holds the file may be offline.

## Decision

`avn-tool-fs`, which owns `read_image`, also listens on `agent/turn-stopping` while an attachment store is mounted. For every Markdown image source in the Turn's `assistant/message` events that names a local file, it saves the file to the attachment store under the image limits `read_image` applies and appends one `reply-images/stored` event that lists, per image, the reply's seq, the source as written, and the attachment. The Client's `read-images` index reads that event, so the reply shows the stored copy through the same session-authorized attachment read as a `read_image` copy. `confineToWorkspace` limits the copies to the session's workspace. A source that is absent, unreadable, too large, or not an image is skipped and keeps its written source.

As a fallback for replies written before this change, `workspaceImagePath` now passes a local path outside the workspace to `/api/workspace-file` as written; the Host serving the session resolves it under its own read rule, and a Host that confines reads answers 404.

## Alternatives considered

**Rely on workspace file sync.** File sync carries folder workspaces between devices, never files outside them, and never to the hosted Host, so a preview saved under `~/Documents` would still have no source while the desktop is offline.

**Fall back to an earlier Turn's stored copy of the same path.** The previews are rewritten on every revision, so an older copy would show a stale image as current.

## Consequences

The new event type is required-on-read: a build that predates it refuses logs carrying it, so the hosted Host must update with the desktop. Each closing Turn reads and stores the local images its replies name; the store is content-addressed, so a file already stored by `read_image` adds no bytes.

## Verification

`tsc` passes for `@aeven/tool-fs` and `@aeven/client-ui-chat`, and `pnpm run build:client` succeeds. The live check is a new reply that shows a local image outside the workspace, opened on chat.aeven.io with the desktop offline.
