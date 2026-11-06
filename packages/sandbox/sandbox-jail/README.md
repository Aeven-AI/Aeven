---
description: "Per-account process jail for operators running a Linux Host that serves many accounts: what a confined command can see, the limits it runs under, and the host setup it needs."
kind: "package-reference"
---

# @aeven/sandbox-jail

English | [中文](README.zh.md)

## Summary

`avn-sandbox-jail` provides the `ctx.sandbox` backend for a Linux Host that runs the commands of many accounts, such as hosted Aeven Web. Every confined command runs under bubblewrap in fresh user, mount, PID, IPC, UTS, cgroup, and network namespaces. It sees the configured read-only system paths, the calling account's own folder, and a private `/tmp` and `/dev/shm`, and it has no network. The Landlock launcher confines the same view again, and the command joins its account's cgroup, which caps its CPU, memory, and process count. A workspace root outside the accounts root, or one that spans two accounts, fails closed with `SANDBOX_UNAVAILABLE`, so a command never runs outside an account's jail.

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Further Exploration](#further-exploration)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="use-this-package"></a>
## Use this package

Mount this provider in place of [`avn-sandbox-local`](../sandbox-local/README.md) when one Host runs commands for people who must not reach one another's files or the Host's own data. The [hosted bundle](../../bundle/hosted-app/README.md) mounts it when `AVN_HOSTED_SANDBOX=1`, together with the managed account folders of [`avn-working-directory`](../../session/working-directory/README.md) and a `workspace-write` ceiling on [`avn-sandbox-policy`](../sandbox-policy/README.md).

### When to choose it

Choose it for a multi-account Linux Host. Choose `avn-sandbox-local` for a person's own computer: its profiles keep the whole disk readable and the network open, which suits one owner and is unsafe for many.

### Minimal configuration

```yaml
- id: sandbox-jail
  name: '@aeven/sandbox-jail'
  config:
    accountsRoot: /srv/aeven/sandbox/accounts
    cgroup:
      root: /sys/fs/cgroup/system.slice/aeven-hosted.service
      total: { memoryMax: 32G, pidsMax: '4096', cpuMax: 1200000 100000, cpuWeight: '100' }
      account: { memoryMax: 2G, pidsMax: '256', cpuMax: 200000 100000, cpuWeight: '100' }
```

| Field | Default | Meaning |
|---|---|---|
| `accountsRoot` | required | Directory whose direct children are account folders; every workspace root must lie inside one |
| `bwrap` | `/usr/bin/bwrap` | Host path of bubblewrap |
| `launcher` | the npm launcher | Host path of the Landlock launcher |
| `readOnlyPaths` | `/usr` and a minimal `/etc` set | Host paths mounted read-only at the same path; missing paths are skipped |
| `symlinks` | `/bin`, `/sbin`, `/lib`, `/lib64` into `/usr` | Symlinks created in the jail root |
| `env` | `PATH`, `LANG`, `TMPDIR`, one BLAS thread, headless matplotlib | The complete environment of confined commands; `HOME` is the account folder |
| `tmpSizeMb` | `512` | Size bound of each of `/tmp` and `/dev/shm` |
| `cgroup` | none | Delegated cgroup directory plus combined and per-account limits |
| `quotaCommand` | none | Argv run once per account before its first command, with the account folder appended, to limit its disk use; a failure refuses the account's commands |
| `modelNote` | none | System-prompt text describing what commands can use |

The generated [configuration catalog](../../../docs/config-catalog.md#aevensandbox-jail) is the exhaustive source for every accepted field and its JSDoc.

### Host setup

Each step runs once per machine, as root unless noted.

1. Install bubblewrap: `apt-get install bubblewrap musl-tools`.
2. Ubuntu restricts unprivileged user namespaces. Allow them for bubblewrap only, with `/etc/apparmor.d/bwrap`, then load it with `apparmor_parser -r /etc/apparmor.d/bwrap`:

   ```text
   abi <abi/4.0>,
   include <tunables/global>

   profile bwrap /usr/bin/bwrap flags=(unconfined) {
     userns,

     include if exists <local/bwrap>
   }
   ```

3. Build the Landlock launcher in the deployed checkout, as the Host's user: `pnpm --dir native/landlock-run run build:native`.
4. Run the Host in a systemd unit with `Delegate=yes` and `DelegateSubgroup=host`. systemd starts the Host in `<unit>/host`, and this provider creates `<unit>/jail/acct-<account>` beside it.
5. Put `accountsRoot` on its own ext4 filesystem with project quotas, such as a loop image created with `mkfs.ext4 -O quota,project` and mounted `loop,prjquota,nosuid,nodev`, so commands cannot fill the Host's disk. A root-owned helper reached through `sudo -n` as `quotaCommand` gives each account folder a project id (`chattr -R +P -p <id>`) and a limit (`setquota -P`); a jailed process cannot change a project id.
6. Install the read-only programs and libraries commands may use under a path listed in `readOnlyPaths`, such as a Python virtual environment and a Node `node_modules` directory under `/opt/aeven-sandbox`. Precompile Python bytecode with `python3 -m compileall`, because the jail cannot write `.pyc` files and pandas then imports five times slower.

### Failures and recovery

Startup fails loud when the launcher cannot enforce Landlock, when bubblewrap cannot create the jail's namespaces (the AppArmor profile is missing), or when the cgroup directory is not delegated. A call whose workspace root is outside one account folder throws `SANDBOX_UNAVAILABLE`. A command that writes outside its folder, `/tmp`, or `/dev/shm` fails with `Read-only file system` or `Permission denied`, which the bash tool reports as a sandbox denial.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: config, startup probes, account check, per-call wrap |
| [`src/profile.ts`](src/profile.ts) | bwrap mounts and Landlock grants for one call |
| [`src/cgroup.ts`](src/cgroup.ts) | Combined and per-account cgroups under the delegated directory |
| — | No runtime invariant companion is published; the provider holds no event sequence or mutable relation that a second observation could contradict. |

### One call

`confine()` canonicalizes the workspace root, takes the account from its first path component under `accountsRoot`, and builds `bwrap … -- /run/aeven/landlock-run … -- <argv>`. With cgroups configured, a `/bin/sh` step first moves itself into the account's group and then `exec`s bubblewrap, so the jail and everything it starts are counted there. A failed move exits 125 with a `sandbox-jail:` line, which consumers classify as a runner failure.

### Two barriers

bubblewrap builds a root holding only the listed paths, so other accounts' folders and the Host's files do not exist in the jail. Inside it, Landlock grants read access beneath that root and write access only to the account folder, `/tmp`, `/dev/shm`, and `/dev/null`. A path reached through a mount-namespace escape is outside the granted hierarchy and stays denied. `--disable-userns` stops the command creating further user namespaces, and the network namespace has only an unconfigured loopback interface.

### cgroups

`<root>/jail` caps all confined commands together, so the Host in `<root>/host` keeps its CPU share and memory. Each `acct-<account>` group caps and weights one account. Groups are created on an account's first command and removed at disposal when empty.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Process sandbox subsystem](../../../docs/subsystems/sandbox.md) — modes, per-call policy, and classification dialects.
- [Hosted sandbox Agent Note](../../../.agents/notes/implemented/feature/2026-11-06-hosted-sandbox-jail.md) — why the jail is a `ctx.sandbox` backend and how it was measured.
- [Local sandbox provider](../sandbox-local/README.md) — the single-owner backend this replaces on hosted Hosts.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through [`avn-bash-sandbox`](../../shell/bash-sandbox/README.md) and [`avn-tool-bash`](../../shell/tool-bash/README.md), which render this provider's denial facts. Commands see the account folder as their working directory and home, no network, and only preinstalled programs; a failed `pip install` or download is the command's own output.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Linux only, shared kernel** — the jail shares the Host's kernel, so a kernel privilege escalation from inside it reaches the machine. Put the Host on a machine that holds nothing beyond what it serves, or move execution to a separate machine.
- **Every command starts its interpreter** — a Python command pays its imports (about 0.4 s for pandas) on each call; a preloaded interpreter that forks per command is deferred.
- **Commands spawn from the Host process** — forking a large Host costs milliseconds per command; spawning from a small executor process is deferred.
- **Managed `AVN_*` variables do not reach commands** — the jail sets the complete environment from `env`.
- **No system-call filter** — the jail relies on namespaces, dropped capabilities, `no_new_privs`, and Landlock; a seccomp filter is deferred.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: undecided directions and open questions. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: preforked interpreters

Measured on the hosted machine, a preloaded pandas and matplotlib process that forks and applies Landlock per command ran a pandas command in 12 ms instead of 381 ms, at about 5 MB per concurrent command instead of 42–50 MB. It needs a per-command interpreter entry point inside the jail and is not decided.

</details>
