# Agent Note: Produced-file sidebar previews

Status: implemented

English | [中文](2026-10-21-produced-file-sidebar-preview.zh.md)

## Problem

New-file pills advertise sidebar previews, but the chat opener delegates to the Host default application.

## Decision

The Files plugin owns `sidebarFiles.open`. Deliverables call it for new-file pills and edited-file rows; an existing pane showing the file receives focus, or a new Files pane consumes a pending per-session path after mounting, preserving the other open files. File reads retain the workspace Remote access checks. PDF, Office, iWork, OpenDocument, and other binary files without a sidebar viewer use the Host default-app opener, including opens from the explorer tree and search results. Prose links and desktop menus keep their existing destinations.

## Alternatives considered

**Use the chat opener:** it intentionally opens paths through the Host and also serves edited rows and prose links; changing it would broaden the requested behavior.

## Consequences

Created and edited files share one table component; created-file tables omit line counts. Deliverables require the Files plugin. Sidebar previews use its existing code, Markdown, and image viewers; HTML displays source. Requests are browser-memory state and do not alter session logs.
