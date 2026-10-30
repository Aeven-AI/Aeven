---
description: "The right sidebar's Files content kind: the session workspace as a tree loaded one folder at a time, a name search, and a viewer for the open file."
kind: "package-reference"
---

# @aeven/client-ui-sidebar-files

English | [中文](README.zh.md)

## Summary

The Files pill in the right sidebar shows the session's workspace: a tree that loads one folder per request, a name search over the workspace, code and Markdown rendering for the open file, and desktop-open actions for row paths. Content plugins join the column through its registry, so this package contributes the `files` pane, its copy, and the `sidebarFiles` opener. Folders, file text, and search hits come from the `workspaceFiles` Remote on demand; the open folders, the query, and the tree's dock state are remembered per session and pill in browser memory, so a reload starts at the root.

## Table of Contents

- [Use this package](#use-this-package)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Compose it in a web client whose sidebar should browse the session workspace. It needs `sidebarContent`, `remote`, `remote.workspaceFiles`, and `remote.session`. `apply` registers the `files` pane and its dictionaries inside effects on the plugin fiber, so disposing the fiber withdraws the kind, and the registration waits for the column's registry rather than racing the column's own apply. The pane lists a folder with `workspaceFiles.list`, reads the open file with `workspaceFiles.read`, searches names with `workspaceFiles.search`, and asks `session.canOpenWorkspacePath`, `session.workspacePathApplications`, and `session.openWorkspacePath` for the row menu.

`sidebarFiles.open(sessionId, path)` focuses a Files pane already showing the requested file, or opens a new pane, and shows the sidebar. The opener returns `false` for PDF, Office, iWork, OpenDocument, and other binary files without a sidebar viewer so callers can use the default app. Tree, search, and row-menu opens send these files directly to the Host default application without opening a sidebar viewer. Requests wait for the selected pane to mount; the viewer reads through `workspaceFiles` and retains its workspace access checks.

-----

<a id="further-exploration"></a>
## Further Exploration

Read these when the pane's contract is not enough: the column it joins and the composition model behind that seat.

- [ui-sidebar-select](../ui-sidebar-select/README.md) — the content registry and pill set this pane registers into.
- [ui-sidebar-right](../ui-sidebar-right/README.md) — the column that renders a session's pills.
- [Web client architecture](../../../docs/subsystems/web-client.md) — how browser plugin rows load and register slots.

-----

<a id="model-experience"></a>
## Model Experience

None, as the explorer reads folders, file text, and search hits through the `workspaceFiles` Remote and renders them without contributing context; the model reads files with its own tools.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

These limits define what the explorer shows and what it leaves to the Host.

- **No invariant companion** — No invariant companion is published because the pane owns only effect-scoped registrations, the `files` entry in the content registry and its locale dictionary, while every value it shows is re-read from the `workspaceFiles` Remote, so nothing here holds a copy an observer could compare against the Host's answer.
- **The tree loads one folder per request** — a folder arrives when it is opened, so a file whose parent folders are closed is reachable only through the name search.
- **Search matches names, not contents** — a file whose text mentions the query is not a hit.
- **Remembered navigation does not survive a reload** — open folders, the query, and the dock state live in browser memory for the mounted session and pill.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
