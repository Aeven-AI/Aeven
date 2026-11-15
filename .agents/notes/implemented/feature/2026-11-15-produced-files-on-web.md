# Agent Note: Produced Files Open on Aeven Web

Status: implemented

English | [中文](2026-11-15-produced-files-on-web.zh.md)

## Problem

On chat.aeven.io a conversation runs on the user's desktop, and session sync shows it on the web. A resume built there ended on the produced-files row with `cv.pdf`, `cv.docx` and `cv.pages`, but each of them answered "not found" on the web. PDF, Word and Pages files have no Files sidebar viewer, so the row downloads them from `/api/workspace-file` on the page's own origin; the cloud Host serving chat.aeven.io confines reads to the account folder, and `/Users/…/.aeven/chats/cv/…` exists only on the Mac.

## Decision

The desktop keeps a copy of each produced file with the conversation. `avn-tool-bash` gains `copyOutputFiles`: each non-image file a command lists in `output_files` and produces is stored as a file attachment, inside the workspace or not, and its `producedFiles` entry records the attachment id and the full reference as `copy`. Nothing shows at the call and the model's result is unchanged, so the transcript and the model see what they saw before. `avn-web-app` turns it on for the `aeven` preset's `tool-bash` row; `avn-hosted-app` replaces that row's whole `config` with its own `shareOutputFiles`, and the two options refuse to load together.

Session sync already publishes every attachment an event names by `sha256:` id, and `/api/attachment-file` already serves a file reference found in a tool result's `meta`, as `show_motion` films use. The produced-files row downloads a document from that copy when the page cannot open the Host path, and from `/api/workspace-file` otherwise.

## Alternatives considered

**Fetch on click.** The web page would ask the desktop for the file when it is clicked. Nothing is uploaded until then, but it works only while the desktop is online and needs a request channel between Hosts that does not exist; the user chose the synced copy.

**Turn on `shareOutputFiles` on the desktop.** It refuses declared paths outside the workspace, which on the desktop include a user's own folders, and it shows every file at the call and tells the model about it.

## Consequences

Each produced document is stored twice on the desktop and uploaded to the relay once, within the per-call (10 files, 100 MiB) and per-conversation (500 MiB) caps, which now count copies. Images keep no copy, because the image route does not search result metadata. Inline mentions of produced files in the closing prose still go through the Host opener, which cannot open a desktop path from the web; the chat view's mention face carries no Session id to build a copy URL from. Windows desktops run `tool-pwsh`, which has no `output_files` copy.

## Verification

`tsc` passes for `tool-bash` and `ui-deliverables`.
