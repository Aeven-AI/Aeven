# Agent Note: Per-account command jail for hosted Aeven Web

Status: implemented

English | [中文](2026-11-06-hosted-sandbox-jail.zh.md)

## Problem

Hosted Aeven Web ran no command at all, because the Host's disk and processes belong to every account it serves. People still want what a code-running assistant offers: analysing a spreadsheet with pandas, drawing a chart, producing a document with Python or Node. The local sandbox cannot provide that on a shared Host: its bwrap and Landlock profiles keep the whole disk readable and the network open, a chat without a workspace writes into one shared `chats` folder, and an approved escalation to `danger-full-access` would run on the Host itself.

## Decision

`@aeven/sandbox-jail` is a second Linux `ctx.sandbox` backend. Each confined command runs under bubblewrap in fresh user, mount, PID, IPC, UTS, cgroup, and network namespaces with `--disable-userns`. The jail root holds only the configured read-only system paths and runtime image, the calling account's folder, and private size-bounded `/tmp` and `/dev/shm`. The Landlock launcher re-confines that view inside the jail, and a `/bin/sh` step moves the command into `<unit>/jail/acct-<account>` before bubblewrap starts, so CPU, memory, and process limits apply per account and in total. A workspace root outside the accounts root, or spanning two accounts, throws `SANDBOX_UNAVAILABLE`.

`avn-working-directory` gains `managedRoot`: with `folders: false`, a session gets `<managedRoot>/<owner>/workspaces/<workspace id>`, or `<managedRoot>/<owner>/chats` when it is filed in no workspace. `avn-sandbox-policy` gains `ceiling`: an approved escalation above it is refused, a session override above it resolves to it, and `avn-tool-bash` offers only escalation targets within it. Both default to the previous behavior, so the desktop and web compositions are unchanged.

The hosted patch mounts the jail, the managed folders, a `workspace-write` ceiling, and the bash tool when `AVN_HOSTED_SANDBOX=1`, and never mounts the local sandbox. Commands get no network and cannot install packages; the image at `/opt/aeven-sandbox` provides Python with the data, plotting, machine-learning, and Office-document libraries (bytecode precompiled) and a set of Node libraries.

## Alternatives considered

A remote sandbox per account (E2B) or a gVisor or Firecracker sandbox per account isolates more strongly but adds 0.1–1 s per command or per-sandbox memory, plus network round trips or a second runtime to operate. Measured on the hosted machine, bubblewrap with Landlock added about 5–6 ms per command and no measurable cost to running code, so the jail keeps density high while leaving those backends available behind the same seam.

Replacing `ctx.fs` and `ctx.subprocess` with a per-account execution world, as the E2B family does, was rejected for this step: the bash consumer already wraps every command through `ctx.sandbox`, so a stricter backend there covers the shell with no change to the tools, and file tools stay disabled on hosted Hosts.

Keeping the local providers with a stricter profile flag was rejected: the local profiles promise a single owner's view, and a flag would make one package carry two security models.

Creating a cgroup per command was rejected after measurement: creating and removing one cost about 13 ms and a third of launch throughput, while a group per account is created once and also gives per-account fairness.

## Consequences

Hosted sessions can run bash, Python, and Node in their account's folder, and files persist in it between commands and conversations. The jail shares the Host's kernel, so a kernel privilege escalation reaches the machine; the hosted machine also runs the API and the database. Each command still starts its own interpreter and is spawned from the Host process; a preforked interpreter and a separate executor process are deferred. Managed `AVN_*` variables do not reach jailed commands, and file tools, the Files sidebar, and deliverables stay disabled.

The host needs bubblewrap, an AppArmor profile that lets bubblewrap create user namespaces, the Landlock launcher built in the deployed checkout, the runtime image, and a unit with `Delegate=yes` and `DelegateSubgroup=host`.

## Verification

On the hosted machine the plugin ran under a transient unit with the same delegation, unprivileged. pandas, matplotlib, scikit-learn with joblib, the Office-document libraries, and Node libraries ran, and files persisted between commands. Reading another account's folder, the Host's home and checkout, `/etc/shadow`, and `/home` failed; writes to `/usr` and the image failed; the Host's loopback port, the internet, and the metadata address were unreachable; pip was absent; host processes and nested user namespaces were unavailable; 400 forks hit the process limit; a 3 GB allocation was killed at the 2 GB account limit; roots outside one account were refused. Typecheck and build pass.
