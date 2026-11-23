# Agent Note: Aeven Cloud Joins Workspace Sync

Status: implemented

English | [中文](2026-11-23-cloud-joins-workspace-sync.zh.md)

## Problem

A cloud session filed in one of the account's project workspaces worked in the hosted Host's own copy of the project, under the account's `.aeven-projects/<workspace id>`, which file sync leaves out so the project is not synced twice ([chat files live in the Aeven folder](2026-11-23-chat-files-live-in-the-aeven-folder.md)). Edits a cloud session made there that it did not push through Git existed only on that Host: the account's desktops never saw them, and losing the Host lost them. Desktops already exchange such work through workspace sync: a folder workspace as a file sync folder, a repository through Git plus work-state checkpoints. The hosted Host ran neither, because both run Git and file operations as the Host's own user, which on a Host serving many accounts would let one account's repository configuration, hooks, or links reach every other account.

## Decision

The hosted Host is a device of each account's folder and repository workspaces, in a managed mode both Consumers take from a new `managedRoot` setting (`avnHomePath('sandbox', 'accounts')` in the hosted bundle, with `AVN_SYNCTHING` and `AVN_HOSTED_SANDBOX=1`):

- **Placement.** A workspace arrives only once a session of it runs a turn on the Host, in `<managedRoot>/<owner>/.aeven-projects/<workspace id>` (`placeManagedWorkspace` in `@aeven/workspace`, numbered when the name holds other files). Existing copies are never searched. A repository's turn waits for its clone or copy; a folder's reads wait for the files they need, as on any device. A session that recorded the placeholder directory before its workspace arrived then works in the bound directory: on a Host without folders of its own, `working-directory` prefers a bound workspace's directory to a recorded one outside it.
- **Git in the jail.** `workspace-git-sync`'s Git runner takes a `confine` hook, which the managed mode builds on the sandbox capability: every Git command runs in the account's jail with the work tree as its root and the one transfer folder it uses as the only other root, its environment passed through `env`, `safe.directory=*` because the jail's user owns neither the directories the Host created nor the work tree, and the remote's HTTPS form, the one form the egress proxy carries.
- **No Host file access inside a work tree.** Copies into or out of a work tree run as confined `cp` commands: a checkpoint's untracked files, a received checkpoint's untracked files, and environment files, which the Host first writes into a staging folder no jail has mounted. A checkpoint folder moves into place with one rename instead of a recursive copy, and its description is created exclusively. Transfer folders live in the account's `.aeven-projects/.transfer`, which no session's jail mounts. The Host publishes no environment files, shows no conflict text, and resolves no conflicts, since each would read or rename files an account's commands can write.
- **Every device.** Untracked files that are symbolic links no longer travel in checkpoints, and a received environment file whose path has an empty, `.`, `..`, or `.git` segment is skipped.

## Alternatives considered

**Sync `.aeven-projects` as part of the Aeven folder.** That sent each project twice, once through Git and once as files without `.git`, which #763 removed.

**Back the cloud copies up to the encrypted file cloud only.** Nothing would be lost with the Host, but the work would still not reach the desktops, and restoring it would need decrypting the file cloud copy by hand.

**Run Git and the copies as the Host's own user with path checks.** Node has no `openat`, so a check of a path and the write through it can be raced by a command that swaps a directory for a link; a jail that cannot see other accounts needs no such check.

## Consequences

Work a cloud session does in a project reaches the account's desktops through the same checkpoints desktops exchange, and a desktop's work reaches the cloud the same way, so no project work lives only on the Host. The first cloud turn in a project waits for its clone. Clones count against the account's jail quota and reach Git hosts only through the egress proxy, with the account's own Git credentials. A cloud copy made before this change stays in `.aeven-projects/<workspace id>`, and the synced copy takes the numbered directory beside it. The cloud's environment files do not travel back, and conflicts in a plain folder are resolved on a desktop.

## Verification

`pnpm run typecheck` and `pnpm run build` pass. The live check runs a cloud turn in a repository workspace: the repository arrives in the account's `.aeven-projects`, an edit made there appears in the same checkout on a desktop before its next turn, and the jail's process list shows Git running confined.
