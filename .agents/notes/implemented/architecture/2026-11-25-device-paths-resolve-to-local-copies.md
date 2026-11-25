# Agent Note: paths another device recorded resolve to this device's copies

Status: implemented

English | [中文](2026-11-25-device-paths-resolve-to-local-copies.zh.md)

## Problem

A conversation names its files by the absolute paths of the device that ran it: produced files, reply images, prose links, and the files a client asks the explorer to open. On 2026-11-25 the desktop conversation `session-45df5e4a…` made `~/Documents/Aeven/vase-reassembly`, and on chat.aeven.io clicking its `index.html` did nothing, although pink held the synced folder with every file. Each Host entry point resolved a client path on its own: only the `/api/workspace-file` byte route mapped a path inside another device's Aeven folder to this device's copy; `workspaceFiles.read`, which the explorer calls before it opens a file, resolved `/Users/Mac/...` on pink and found nothing. A path under the conversation's project root on the desktop had no mapping anywhere, although workspace sync keeps the project's copy in `.aeven-projects/<id>` on pink. And on a Host with a managed root, a project's files arrive only when a conversation of it runs a turn there, so a desktop-only project was never on pink at all. Each symptom had been patched where it surfaced.

## Decision

- `@aeven/api-workspace-files` resolves every client path through one place per conversation: its workspace root here, its account, and every root its log recorded. `toLocal` replaces a recorded root of another device with the root here; reads and the file route then take the account's Aeven folder copy for a path inside any device's Aeven folder. Listings, previews, the file route, `sidebar_files`, and the explorer writes all go through it.
- The `workingDirectory` projection keeps `roots`: every root a `session/cwd` event recorded. With the header's `cwd`, that names each device's root for a conversation that moved between devices.
- `WorkspaceRegistry.wantSessionFiles` emits `workspace/session-files-wanted`. Opening the explorer and any read that finds nothing call it, bounded by `arrivalWaitMs`. Workspace file sync answers as for a turn; workspace Git sync fetches the repository and applies newer work another device checkpointed, unless a turn of that repository runs here. Reads of files still arriving wait for them through the existing `fs/pre-read` queue.

## Alternatives considered

- **Patch each entry point as a symptom shows.** Rejected: that is how the byte route and the text read came to disagree.
- **Ask the device that ran the conversation for each file.** Rejected for now: session handoff forwards inputs one way through the account inbox, with no request-and-response channel, and the file would still be unavailable while that device is off, which file sync exists to prevent.
- **Map only the latest recorded root.** Rejected: a conversation that ran on a desktop, then in the cloud, then on another desktop names files under all three roots.

## Consequences

A conversation's files open on every device that holds a copy, whichever device wrote them. The first open of a project's explorer on a managed Host starts that project's transfer, which can be large; the read waits up to `arrivalWaitMs` and the transfer continues. A path outside every recorded root and outside the Aeven folder still resolves as written, so a file on no synced copy is reported missing.
