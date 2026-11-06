# Agent Note: Files from the hosted command jail

Status: implemented

English | [中文](2026-11-06-hosted-sandbox-files.zh.md)

## Problem

With the [per-account jail](2026-11-06-hosted-sandbox-jail.md), hosted commands produce charts, documents, and spreadsheets in the account's folder, but nothing brought them to the reader: the Files sidebar, the produced-files row, and the workspace file routes were off because they read the Host's own disk. Around the jail, four further gaps remained. `output_files` paths were looked up on the Host, so a model could probe whether another account's or the Host's files existed or changed. Account folders had no disk limit, so one account could fill the disk the API and the database share. Host reads of account files followed paths resolved earlier, so a jailed command could swap a path component for a symlink between the check and the read. The model did not know the jail has no network or which libraries it offers.

## Decision

`avn-tool-bash` gains `shareOutputFiles`. A declared output path outside the session workspace is refused before any lookup. Each produced file inside the workspace is stored through `ctx.attachments`, the per-account lane generated media already use: images as image blocks shown inline, other files as file blocks offered for download, with result text telling the model the reader already sees them.

`avn-fs-sandbox` gains `verifyReads`: every read opens the file without following a final symlink, checks through `/proc/self/fd` that the opened file is the resolved one, and reads through that descriptor. `avn-api-workspace-files` gains `confineReads`, which keeps previews inside the workspace like listings, and its Remote already answers only for the caller's own sessions. In `avn-ui-sidebar-select`, a registered pane outranks a launcher of the same kind, so the Files pane replaces the desktop-handoff prompt where both are composed.

`avn-sandbox-jail` gains `quotaCommand` and `modelNote`. The hosted accounts root is its own ext4 filesystem with project quotas, a sparse loop image mounted `nosuid,nodev`. A root-owned helper reached through `sudo -n` gives each account folder a project id and a 5 GiB, 200,000-file limit before its first command, and refuses any path that is not one account folder. A jailed process cannot change a project id, because the kernel only allows that from the initial user namespace. The note tells the model that commands have no network, that nothing can be installed, which Python and Node libraries exist, and to list deliverables in `output_files`.

The hosted patch turns all of this on with `AVN_HOSTED_SANDBOX=1`; every new setting defaults to the previous behavior elsewhere.

## Alternatives considered

Serving account files over the existing workspace HTTP route was rejected: it serves any registered workspace to any signed-in browser, and hosted folders are not registered workspaces. A new per-account download route would duplicate the authorization, storage, and display the attachment lane already gives tool results.

A loop image per account was rejected: mounting needs root for every new account and leaves a mount per account; one project-quota filesystem needs one mount and a per-account quota set.

Fixing the read race inside `avn-fs-local` for every composition was deferred: the check depends on Linux `/proc`, and only Hosts whose confined processes share the directories their readers are served from need it.

## Consequences

Hosted readers see the charts and files commands list as outputs and can browse their folder read-only in the Files sidebar. File tools stay off, so the model still reads and writes files through commands; an account-confined file backend for them, attachments copied into the account folder, and running `ffprobe` inside the jail are separate work. Shared files are stored once more as attachments, which count toward the attachment store rather than the account folder's quota.

## Verification

On the hosted machine, the accounts filesystem mounted with `prjquota`; the helper set a 10 MiB limit on a test folder, and a 20 MiB write stopped at the limit; the helper refused `/etc`; a process in a bubblewrap user namespace failed to change a file's project id. Typecheck and build pass.
