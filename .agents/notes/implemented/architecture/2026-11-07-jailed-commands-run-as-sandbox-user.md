# Agent Note: Jailed commands run as a sandbox user apart from the Host's

Status: implemented

English | [中文](2026-11-07-jailed-commands-run-as-sandbox-user.zh.md)

## Problem

On hosted Web, every jailed command, the Python zygote, and the Host itself ran as `aeven-hosted`, the user that owns every account's conversations, memory, attachments, and the Host's credentials. The jail's namespaces, Landlock, and seccomp were the only barrier, so a command that escaped its jail through a flaw in how the jail is built, without a kernel exploit, would hold all of that.

## Decision

`avn-sandbox-jail` gains `commandUser`. Each launch step, still under the Host's user, joins the account cgroup, runs the quota step, and opens the seccomp filter and the attachments, then executes `aeven-sandbox-exec`. That helper, built from `host/sandbox-exec.c`, is executable only by the Host's group and holds only `cap_setuid` and `cap_setgid`. It forks a waiter that switches to `aeven-sandbox`, drops every capability, and starts bubblewrap. The Host-side process stays under the Host's user, so the Host signals it as before. The waiter relays each signal it receives through a pipe and kills the command when that pipe closes; a parent-death signal cannot do this, because executing bubblewrap changes its AppArmor domain, which clears it. bubblewrap mounts each account root from a second mount of the accounts filesystem at `accountsPath`, which the sandbox user can traverse but not list, at its usual path inside the Host's data directory, which the sandbox user cannot enter. It copies attachments in with `--ro-bind-data`. ACLs give both users access to account folders and to what either creates there; the provider opens the ACL mask of the 0700 folders the Host creates. The Python zygote runs as the sandbox user in `<root>/jail/zygote`, with its socket in `/var/lib/aeven-zygote`, and `jail` and every account group let the sandbox user's group write `cgroup.procs`, so a run moves into its caller's group. `host/install-sandbox-user.sh` prepares a Host, and the hosted patch enables it.

## Alternatives considered

A separate machine for execution was set aside because the deployment has one. `sudo -u` per command was rejected because it costs several milliseconds, logs every command, and closes the descriptors the launch passes. Binding account folders from descriptors (`--bind-fd`) was rejected, because bubblewrap re-resolves the descriptor's path, which the sandbox user cannot traverse. Granting the sandbox user traversal of the Host's data directory was rejected, because files there that are readable by others would become reachable by name.

## Consequences

A jail escape now holds the sandbox user's rights: account folders whose names it finds, and nothing in the Host's data directory. Switching costs about 1.6 ms per command. A file a command creates with mode `0600` stays unreadable to the Host, and attachments cost a copy per command; the README lists both.

## Verification

Typecheck, lint, duplication, and build pass. On the hosted machine, in delegated transient units running as `aeven-hosted`, the jailed command ran as `aeven-sandbox` with no capabilities. It read its attachment and wrote its folder, and the Host read what it wrote. The zygote ran pandas as the sandbox user in about 30 ms. Outside a jail, the sandbox user could neither list `/srv/aeven-accounts` nor open the Host's data directory or keys. A process-group SIGKILL, a SIGTERM, and a SIGKILL to the helper each ended the command at once. Exit statuses passed through.
