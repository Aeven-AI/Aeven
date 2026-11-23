# Agent Note: Chat Files Live in the Aeven Folder

Status: implemented

English | [中文](2026-11-23-chat-files-live-in-the-aeven-folder.zh.md)

## Problem

A user asked Aeven Cloud to crop five photos into one listing image ([issue 761](https://github.com/Aeven-AI/Aeven/issues/761)). The cloud session sat in the account's folderless Chats workspace, so the hosted Host ran it in its managed folder `sandbox/accounts/<account>/workspaces/<chats id>/`, and the image was written there. No file sync folder covered that path: the hosted Host shared only the account's Aeven folder, under `aeven-folders/<account>`, and its sessions could not write it ([synced Aeven folder](../feature/2026-11-16-synced-aeven-folder.md)). On the user's Mac the same conversation resolved its relative paths against `~/.aeven/chats`, the desktop's folder for chats without one, which nothing syncs either. Clicking the produced file raised `path open failed: path open failed: Command failed: open …`, and the image the reply embedded by its cloud path showed as a link. A desktop that made files in a chat without a project kept them only on that machine, so losing the machine lost them.

## Decision

A chat without a folder of its own works inside the account's Aeven folder on every device, in its `chats/` folder: an unfiled session, and one filed in a workspace without a folder, such as Chats. Every device names such a workspace by its own id (Aeven Cloud's Chats id differs from a desktop's), so the folder is named `chats`, never by id.

- **Hosted.** With `AVN_HOSTED_SANDBOX=1`, `aeven-folder-sync` uses `sandbox/accounts` with `perAccount`, so each account's managed folder, the only folder its jailed commands see and the one its disk quota covers, is its Aeven folder. The files cloud sessions make reach the account's desktops and the file cloud. `advertise` stays false: a jailed command sees only its session's subfolder, not the folder's root. A cloud session filed in a folder workspace works in `.aeven-projects/<workspace id>/`, which file sync ignores: that workspace's files already travel through its workspace folder or Git, and syncing the cloud's copy as well sent the same project twice, without its `.git`.
- **Desktop.** `working-directory` asks the new `working-directory/account-folder` bail event for a session that records no directory, or sits in a workspace without a folder, and `aeven-folder-sync` answers with the account's Aeven folder when this device's folder belongs to that account. The session then works in `~/Documents/Aeven/chats`, and a conversation another device ran resolves its relative paths in the copy file sync brought here. Without an answer, such as a second account of a device whose folder another account claimed, the session records no directory and keeps the sandbox policy's `~/.aeven/chats`. The claim of an unowned folder is synchronous so that resolution stays synchronous.
- **Ignores.** The default file sync ignores add `.npm` and `.local`, which a jailed command's home caches inside its workspace, and `.aeven-projects`.
- **Reading produced images.** The turn tail shows a produced image whole, from its stored copy where one was recorded, the way generated images show: a lone image at its own proportions, several as tiles. The `produced-images` Turn data index names those images, so a closed Turn's reply that embeds one, by its path or by the copy `reply-images/stored` recorded, leaves it to the tail.
- **Opening a missing file.** `session/openWorkspacePath` classifies an opener failure at a path where nothing exists as `session/path-missing`, and reports any other failure with the opener's stderr instead of the `Command failed:` line. The chat view's file opener no longer prefixes the Host message. A produced file with a stored copy downloads the copy where the path is missing; otherwise the dialog names the file and the folder and offers that folder instead of a Retry that cannot succeed ([file-open failure dialog](../bug-fix/2026-08-18-tool-row-file-open-failure.md)). A prose link naming only the tail of exactly one produced path opens that path.

## Alternatives considered

**Mount `aeven-folders/<account>` into the jail as a second writable root.** It keeps two folders per account, one under the quota and one outside it, and the cloud's chats would still be written to the managed folder unless the jail's account boundary also moved. Making the managed folder the Aeven folder needs no new mount and keeps every cloud write under the quota.

**Have the cloud join each workspace's file sync folder.** That carries a project's files, but a chat in the folderless Chats workspace has no workspace folder to join, which is where this file was written. It stays open for project workspaces.

**Move `~/.aeven/chats` itself into the Aeven folder in the desktop configuration.** The sandbox policy's root is one path for the whole device, so every account of a multi-account desktop would write into the folder of the account that owns it, and its files would sync to that account's devices.

**Copy every produced file into the attachment store and materialize it on click.** Attachments are per conversation and capped; they stay for what a chat shows, and the folder carries the files.

## Consequences

Files made in chats without a project, on a desktop or on Aeven Cloud, reach every device of the account and the file cloud, so a lost machine no longer loses them. Desktops gain a `chats/` folder inside `~/Documents/Aeven`. Cloud work in a project workspace stays on the hosted Host, recoverable through the project's own sync rather than file sync. A cloud account's synced Aeven folder now counts against its 5 GiB jail quota. On the hosted Host the Aeven folder moves from `aeven-folders/<account>` to `sandbox/accounts/<account>`. Each account's existing folder contents, including Syncthing's `.stfolder` marker, must be moved into the managed folder while the Host is stopped before the new build starts; otherwise Syncthing would find its indexed files absent and send their deletion to the desktops. The hosted data export lists the managed folder twice, as chat files and as the Aeven folder. The desktop runtime context names a working directory for these chats where it named none before.

## Verification

`pnpm run typecheck` and `pnpm run build` pass. `session-open-workspace-path.host.spec.ts` covers the `session/path-missing` classification, and `file-links.client.spec.ts` covers a link that opens the produced path.
