# Agent Note: Uploads, file reads, and hardening for the hosted jail

Status: implemented

English | [中文](2026-11-06-hosted-sandbox-hardening.zh.md)

## Problem

After [sharing jailed command files](2026-11-06-hosted-sandbox-files.md), a review of the hosted jail found remaining gaps. Commands could not open uploads, because the model is given attachment-store paths the jail does not mount. The model could not read a file or look at a chart it made, because file tools were off. A declared output path could still reveal whether a Host file exists through a symlink the command created, and a `.git` file pointing outside the account locked its folder for good. Shared files had no cap, the quota helper and other root-owned host files existed only on the server, `ffprobe` parsed untrusted uploads on the Host, `vcs` stayed mounted, the produced-files row showed Host paths, and the jail had no system-call filter.

## Decision

`avn-sandbox-jail` gains `sessionAttachments`: each command mounts, read-only at their store paths, the attachments that the conversation's user messages and tool results reference, so the path the model is given opens inside the jail. Attachments named only in model-written tool arguments are never mounted, so a model cannot name another account's content address. It also gains `seccompFilter`, a BPF deny list built by `host/seccomp-filter.c` and read by `bwrap --seccomp` through the same `/bin/sh` step that joins the cgroup. Extra writable roots outside the account are left out instead of refusing the folder. `host/` holds the AppArmor profile, systemd drop-in, quota helper, sudoers rule, and filter source; the helper reads its accounts root from the root-owned `/etc/aeven-sandbox/accounts-root`, sets the project id on files and inheritance on directories without following symlinks, and so also runs on folders that already hold files.

`avn-tool-fs` gains `confineToWorkspace`, refusing `read` and `read_image` targets outside the session workspace after symlinks resolve, and `mutations`, which leaves `write` and `edit` out. Hosted mounts `read` and `read_image` only: a Host-side write could follow a symlink a jailed command swaps in, while reads are verified by `fs-sandbox`'s `verifyReads`. File search stays off because it runs ripgrep on the Host.

`avn-tool-bash` fences the post-command resolve of each output path, records shared outputs relative to the workspace, and caps sharing per call (`shareMaxFiles`, `shareMaxBytes`) and per conversation (`shareMaxSessionBytes`, counted from the log). `avn-document-extract-video` gains `probeDirectory` and `probeRunner`; hosted runs `ffprobe` in a network-less bubblewrap jail that sees `/usr`, the library alternatives, and the probe directory. Hosted disables `vcs` and `vcs-git`.

The quota helper runs inside each command's own launch step rather than from the Host, so a long first walk of a folder never blocks the Host's event loop; it records an account only after its limit is set, walks the folder on every run until then so an interrupted walk is finished, and the jail skips the step for accounts the record lists, treating an unreadable record as not listing them. The hosted `ffprobe` jail also links `/lib64` for x86_64 loaders and runs under `prlimit` with 1 GiB of address space and 30 s of CPU.

Later, confined `read` and `read_image` also accept the attachments the conversation's own content references, the files the jail mounts, through one collector in `avn-attachment` that the jail shares; confined reads and declared outputs refuse a path lexically outside the folder before any filesystem call, so no error describes the Host; and sharing is also capped per account per UTC day through a ledger in a Host directory (`shareLedgerDirectory`, `shareMaxAccountBytesPerDay`).

## Alternatives considered

Copying each referenced attachment into the account folder was rejected: it doubles storage against the folder's quota and needs the copy to exist before the model's request is built, while a per-command read-only mount needs neither. Making Host-side writes race-free with descriptor-relative publication was deferred; jailed commands already write without that race. Counting shared bytes per account would need state beyond one conversation's log; the per-conversation cap is derived from durable data alone.

## Consequences

Hosted commands can open uploaded spreadsheets and clips, the model can read files and look at images in the account folder, and `ffmpeg` is available inside the jail. An account can still share up to the per-conversation cap in each of many conversations. Writes stay with commands, and file search with `find` and `grep` inside the jail.

## Verification

On the hosted machine, the filter returned `EPERM` for `unshare` and `ptrace` inside bubblewrap while Node I/O and process spawning worked; `ffprobe` in the probe jail reported codec, size, and duration of a generated clip; the fixed quota helper set the project id on a folder that already held files and refused `/etc`. Typecheck and build pass.
