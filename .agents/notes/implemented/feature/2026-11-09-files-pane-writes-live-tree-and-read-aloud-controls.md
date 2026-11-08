# Agent Note: Files pane writes, live tree, HTML preview, and read-aloud controls

Status: implemented

English | [中文](2026-11-09-files-pane-writes-live-tree-and-read-aloud-controls.zh.md)

## Problem

The right sidebar's Files pane could show a workspace but never change it, kept the listing it first loaded until it was reopened, blanked the tree on Refresh, rendered HTML only as source, and pinned light colours that vanished in the dark theme. Read aloud could wedge on a spinner after quick presses, offered no pause, and existed only on assistant replies. In the dark theme a mobile keyboard uncovered a white document canvas, and the Move to workspace menu listed Workspaces in registry order rather than the sidebar's.

## Decision

- **Writes.** The `workspaceFiles` Remote ([`@aeven/api-workspace-files`](../../../../packages/api/workspace-files/README.md)) gains `access`, `createFile`, `createFolder`, `rename`, `duplicate`, `count`, and `deleteEntry`. Each write resolves the entry's folder inside the workspace as a listing does, validates the new name against the set every platform refuses, and names the entry itself, so a symbolic link is renamed or deleted, never followed. They run on the Host's own filesystem ([`host.ts`](../../../../packages/api/workspace-files/src/host.ts)) and only when the composed filesystem maps the workspace one-to-one onto it; a read-only Session refuses them in the operation and `access` lets the pane show them disabled with the reason. `deleteEntry` uses the platform trash (macOS `trash` or Finder, the Windows Recycle Bin, `gio trash`) and removes the entry where none exists, which `access.trash` reports so the confirmation says which.
- **Live tree.** `changes` streams batches from one recursive `fs.watch` per workspace root, shared by every subscriber and leaving out the `searchSkip` names. The pane gathers a burst into one reload per visible folder, marks collapsed loaded folders stale, and reloads the open file in place. Without a stream it revalidates on window focus and visibility.
- **Reloads.** A reload keeps a folder's rows until its answer lands, aborts the folder's previous request, drops answers from superseded requests, and publishes every folder of a rescan in one update. Refresh spins and is disabled until it settles.
- **HTML preview.** An HTML file opens rendered by default in an iframe sandboxed with `allow-scripts` alone. The page's workspace stylesheets, scripts, images, and media are read through the app and inlined into its `srcdoc` ([`preview.ts`](../../../../packages/client/ui-sidebar-files/src/client/preview.ts)), because the opaque-origin frame cannot authenticate a request for them.
- **Tree.** Rows carry `aria-level` and roving focus, hover and selection take distinct token fills, ignored names hide behind a toggle, only the visible window of rows renders, and the file view has one bar with back and forward through the surface's history.
- **Read aloud.** A stop clears the channel's drain flag and aborts the drain's waits, so a new reading never waits for an abandoned synthesis; a drain belongs to the generation it started in. `pause` and `resume` suspend and resume the shared audio context, and the control shows pause (or play) and stop while playing. A new `conversation.chat.user-actions` slot, rendered before copy on user prompts, carries the same control.
- **Theme canvas.** The index bootstrap and ui-layout's ThemePresenter both copy body's computed background onto `html` and into a `theme-color` meta, and a fixed backdrop sits behind the shell.
- **Move targets.** The workspace browser reports its group order to `uiWorkspace`, and the Move to workspace targets follow it; before a report they use the browser's default recency order.

## Alternatives considered

**A preview route serving the page's own subresources** was rejected: the account cookie is `SameSite=Strict` and admits exact routes only, so a sandboxed frame's subresource requests would be refused, and dropping the sandbox would hand workspace HTML the app's origin. **Adding mkdir, rename, and delete to the `fs` capability** was rejected for now: every provider (local, sandboxed, E2B) would need them for one consumer; the explorer's writes stay in its own service and report themselves unavailable elsewhere. **Pausing by stopping sources and re-queuing the rest** was rejected because it re-synthesizes and can clip a word. **Ordering move targets inside the service from the persisted view store** was rejected: the store instance belongs to the slot framework, and the browser's computed order is the one the reader sees.

## Consequences

Writes and the change stream are unavailable where the workspace is not on the Host's own disk (E2B). On Linux a recursive watch of a large tree costs one inotify watch per directory. A delete on a Host without a trash is permanent. The explorer's writes act for the reader and pass the client confirmation, not the agent approval path. Drag-and-drop, multi-select, moving between folders, and content search are not built.
