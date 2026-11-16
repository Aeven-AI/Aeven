# Agent Note: The Aeven Folder Is Synced

Status: implemented

English | [中文](2026-11-16-synced-aeven-folder.zh.md)

## Problem

Aeven made a set of decks for a user in `~/Documents/Aeven/Presentations` on their Mac and showed the previews in its replies. On chat.aeven.io the second preview showed "Image not shown", and the decks existed on no other device. File sync carried none of it: the session's workspace was a Git repository, which travels through Git, and `~/Documents/Aeven` belonged to no workspace. The hosted Host that serves chat.aeven.io was not a file sync device at all, and the file cloud keeps only a copy it cannot read. Stored attachment copies ([reply image copies](2026-11-16-reply-image-copies.md)) cover what a reply shows, not the files themselves.

## Decision

The Aeven folder is the place for the files Aeven makes for the user, and file sync carries it like a workspace:

- `@aeven/aeven-folder-sync` owns it. The desktop app sets it to `~/Documents/Aeven`. Without `perAccount` it belongs to one account of the device, recorded in its `.aeven-account` file by the first account to attach, so a device that syncs several accounts never sends one account's files with another's. Every device shares it under a folder id derived from the account (a UUID, the form the file cloud accepts), so the account's desktops and the encrypted file cloud copy join one folder without coordinating. Each device records its folder's absolute path in `aeven-folder/paths`, and `localPath` maps a path another device wrote to the copy here.
- The model's runtime context names the folder as the place for the files it makes, and the slides and CV skills work there. The sandbox policy's new `writableRoots` lets every `workspace-write` call write it without asking.
- `/api/workspace-file` serves a path inside any device's Aeven folder from the folder here, whether or not the session's workspace contains it.
- With `AVN_SYNCTHING`, the hosted Host runs Syncthing and keeps each account's Aeven folder under `aeven-folders/<account>`. It lists itself, marked `hosted`, in the account's `file-sync/peers` document and shares with the devices listed there. It does both only while it holds the account key, because the relay holds it or the user unlocked a passkey-protected account there; a Host holding the key already reads everything the account syncs, so desktops share with every peer the account lists. The hosted Host accepts only the Aeven folder; workspace and recording folders offered to it stay pending. Its sessions cannot write the folder, so it does not name it to its model.

## Alternatives considered

**Decrypt the file cloud copy on the hosted Host.** The file cloud holds Syncthing's encrypted blocks under a password derived from the account key; reading one file means decrypting the folder with `syncthing decrypt`, outside Syncthing's own sync, for every change. A trusted peer receives the same files through the transport the desktops already use.

**Copy every produced file into the attachment store.** Attachments travel with the session and are readable on the hosted Host, but they are per conversation, capped, and not a folder the user can open on another Mac. They stay for what a chat shows; the folder carries the files.

**Sync every file the agent writes anywhere.** Syncthing syncs folders, and the agent writes across the whole disk; one known folder keeps what travels predictable and bounded.

## Consequences

A deck, CV, film or preview made on one desktop appears in the Aeven folder on the account's other desktops and, while Aeven Cloud holds the account key, opens on Aeven Web with every desktop offline. A conversation another device writes (a replica) gets no stored reply copies from this device, so its old previews open on Aeven Web through the hosted copy of the folder. Deploying the hosted half needs a Syncthing executable on the Host machine, `AVN_SYNCTHING` and, when the file cloud's instance already holds the default port, `AVN_SYNCTHING_LISTEN` with a reachable port. The runtime context gains one line, `aeven-folder`, on the desktop app. Files written outside the folder keep their old reach: a folder workspace's files, Git, or a stored copy of what a reply shows.

## Verification

`tsc` passes for every changed package and `pnpm run build` succeeds. The live check is a deck made on the desktop app: it appears in `~/Documents/Aeven` on the Linux VM, and its preview opens on chat.aeven.io with the desktop quit.
