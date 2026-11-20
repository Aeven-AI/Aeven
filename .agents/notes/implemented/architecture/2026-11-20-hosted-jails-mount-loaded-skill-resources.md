# Agent Note: Hosted jails mount the resources of the skills a conversation loaded

Status: implemented

English | [中文](2026-11-20-hosted-jails-mount-loaded-skill-resources.zh.md)

## Problem

On Aeven Cloud a skill's instructions could not open their own files. `@aeven/host-account-integrations` writes an installed skill's resources to `<avn home>/accounts/<account>/skills/<name>/<revision>/`, a `0700` directory the Host user owns. A jailed command sees only the read-only system, `/opt/aeven-sandbox`, its account folder, and the aeven preset's own skills, and runs as `aeven-sandbox`, which cannot enter the Host's data directory; the confined `read` tool opens only the conversation folder and its referenced attachments. Every catalog skill with references, playbooks, or scripts therefore failed in a cloud conversation, while the same skill worked on a desktop: `poteto-mode` could read none of its playbooks or principles, and `statechart` and the motion skills none of theirs.

## Decision

Both load paths record the resource directory outside the model-facing text. The `skill` tool's `presentationMeta` writes `meta.resourceDirectory` on its durable `tool/result`, and a `/name` invocation's `SkillInvocationSource` carries `resourceDirectory`. `loadedSkillDirectories()` in `@aeven/skill` reads only those records, and only a `tool/result` whose call id belongs to a logged `skill` tool call, so neither a skill body nor another tool's meta can name a directory.

`@aeven/sandbox-jail`'s `sessionSkillResources: { maxFiles, maxBytes }` mounts every regular file below those directories into each command, read-only at its own path, through the same descriptor copy the jail already uses for attachments: the Host user opens each file and bubblewrap copies it in, so the sandbox user needs no access to the Host's directories. A file whose owner may execute it is copied with `--perms 0555`, which pairs with account-integrations writing a resource that starts with `#!` executable, so a bundled launcher runs by its path. Files past either bound are not mounted, and the Host logs it. `@aeven/tool-fs`'s `confineToWorkspace` also admits reads below those directories. The hosted bundle sets 512 files and 32 MiB.

## Alternatives considered

**Write skill resources into the account folder.** The jail and the confined `read` would see them with no new mount, but the Host would then write into a directory jailed commands control, where a swapped-in symlink redirects the write; the hosted composition already keeps Host writes out of account folders for that reason.

**Bind each account's skills directory into its jail.** One bind per command is cheaper than per-file copies, but the sandbox user cannot traverse the Host's `0700` tree, so it needs a second ACL-granted mount like the account folders, plus host setup on every deployment.

**Parse `Base directory for this skill:` from the logged text.** The same text carries the skill's body, which an account imports from anywhere, so a body could name another account's directory.

**Mount every installed skill of the account.** No log scan is needed, but every command would copy every installed skill, most of them unused by the conversation.

## Consequences

A conversation that loads a skill pays one file copy per resource on each later command, bounded by the configured limits; skills without resource files cost nothing. Resource directories are per revision and never change, so each is listed once per Host process. The record exists only for loads after this change; a conversation that loaded a skill earlier mounts it again once it loads the skill again.
