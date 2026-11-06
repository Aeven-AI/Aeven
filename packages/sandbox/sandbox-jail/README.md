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
| `quotaCommand` | none | Argv that limits the account folder's disk use, run with the folder appended in a command's own launch step until `quotaRecord` lists the account; a failure refuses that command |
| `quotaRecord` | none | File the quota helper lists limited accounts in; omitted, every command runs the quota step |
| `modelNote` | none | System-prompt text describing what commands can use |
| `seccompFilter` | none | Host path of a BPF system-call filter bubblewrap installs; a missing file fails startup |
| `sessionAttachments` | `false` | Mount the attachments the conversation's user messages and tool results reference, read-only at their store paths |
| `pythonZygote` | none | `python`, `script`, `preload`, `socketDir`, and cgroup `limits` of a preloaded Python interpreter that runs jailed `python3` commands; needs `cgroup` and `seccompFilter` |

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
4. Run the Host in a systemd unit with `Delegate=yes` and `DelegateSubgroup=host`. systemd starts the Host in `<unit>/host`, and this provider creates `<unit>/jail/acct-<account>` beside it. Run it as a dedicated user, such as `aeven-hosted`, that has no sudo rights beyond the quota helper ([`host/systemd-user.conf`](host/systemd-user.conf), [`host/sudoers`](host/sudoers)), so a compromised Host process is not root. Set `AVN_HOME` in the unit to the Aeven home the Host used before, owned by that user, because it defaults to `~/.aeven` and changing the user would otherwise move every conversation, attachment, and account folder.
5. Put `accountsRoot` on its own ext4 filesystem with project quotas, such as a loop image created with `mkfs.ext4 -O quota,project` and mounted `loop,prjquota,nosuid,nodev`, so commands cannot fill the Host's disk. A root-owned helper reached through `sudo -n` as `quotaCommand` gives each account folder a project id (`chattr -R +P -p <id>`) and a limit (`setquota -P`); a jailed process cannot change a project id.
6. Write the system-call filter with [`host/seccomp-filter.c`](host/seccomp-filter.c) (`cc -O2 -o seccomp-filter seccomp-filter.c -lseccomp`) and name its output in `seccompFilter`.
7. Install the read-only programs and libraries commands may use under a path listed in `readOnlyPaths`, such as a Python virtual environment and a Node `node_modules` directory under `/opt/aeven-sandbox`. Precompile Python bytecode with `python3 -m compileall`, because the jail cannot write `.pyc` files and pandas then imports five times slower.
8. For animation and video, run [`host/install-motion.sh`](host/install-motion.sh) as root. It installs a headless Chromium (`playwright-core`), GSAP, and open-licensed fonts (Google Sans Flex and other Google Fonts families under the SIL Open Font License, plus Noto for every script, CJK, and colour emoji), and puts `render-motion` in the image's `bin`. `render-motion page.html film.mp4` steps a HyperFrames composition through its runtime's player, otherwise the page's GSAP timeline or its `window.seek(seconds)`, frame by frame and encodes the frames with ffmpeg's libx264; a page of `-` is read from stdin, and `--stills` with `--json` returns evenly spaced frames and the film's facts as one JSON line, which [`avn-motion-sandbox`](../../motion/motion-sandbox/README.md) reads. Rerun the script after updating `render-motion`; it serves CDN GSAP requests from the installed copy and fails every other request. List `/var/cache/fontconfig` in `readOnlyPaths` and set `PLAYWRIGHT_BROWSERS_PATH` in `env`.
9. For fast Python, run [`host/install-python-zygote.sh`](host/install-python-zygote.sh) as root, put `/opt/aeven-sandbox/shim` first on `PATH` in `env`, and set `pythonZygote`. The script builds a static `python3` and `python` shim into `<image>/shim` and installs `python-zygote.py` beside it, which `script` names; rerun it after updating either file. The provider starts one interpreter, outside every jail in `<root>/zygote`, that imports `preload` once; the shim hands it each `python3` call through the socket each jail mounts at `/run/aeven/zygote`. For each call it forks, identifies the caller by the socket's peer pidfd, moves into the caller's account group, joins the caller's namespaces, drops every capability, installs the launcher's Landlock rules for the caller's writable mounts and the jail's system-call filter, and runs the program with the caller's descriptors, directory, environment, and umask. `import pandas, matplotlib.pyplot` then takes about 30 ms instead of 0.9 s. A call the zygote cannot reproduce exactly, such as an interactive session, an unusual flag, a changed `PYTHON*`, locale, thread-count, or Matplotlib variable, or `-c` code that names no preloaded module, runs the image's interpreter instead, as does every call while the zygote is down.

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
| [`src/zygote.ts`](src/zygote.ts) | The Python zygote's process: start in its own group, restart when it ends |
| — | No runtime invariant companion is published; the provider holds no event sequence or mutable relation that a second observation could contradict. |

### One call

`confine()` canonicalizes the workspace root, takes the account from its first path component under `accountsRoot`, and builds `bwrap … -- /run/aeven/landlock-run … -- <argv>`. With cgroups configured, a `/bin/sh` step first moves itself into the account's group and then `exec`s bubblewrap, so the jail and everything it starts are counted there. A failed move exits 125 with a `sandbox-jail:` line, which consumers classify as a runner failure.

### Host files

[`host/`](host/) holds what the setup steps install: the AppArmor profile, the systemd drop-ins for delegation and the Host's user, the quota helper with its sudoers rule, the system-call filter source, the motion installer with `render-motion`, and the Python zygote (`python-zygote.py`, which documents its protocol), its shim source, and the shim's installer. The quota helper reads the accounts root from the root-owned `/etc/aeven-sandbox/accounts-root`, so a caller cannot choose the tree it limits.

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
- **Zygote runs share the zygote's start** — every run forked from one zygote has the same string-hash seed, its `os.getppid()` is 0, and modules imported at start-up keep the environment they read then, which is why a changed import-time variable runs the interpreter instead.
- **Without the zygote every command starts its interpreter** — a Python command then pays its imports (about 0.9 s for pandas and Matplotlib) on each call.
- **Commands spawn from the Host process** — forking a large Host costs milliseconds per command; spawning from a small executor process is deferred.
- **Managed `AVN_*` variables do not reach commands** — the jail sets the complete environment from `env`.
- **The system-call filter is a deny list** — it refuses mount, namespace, tracing, keyring, BPF, module, and handle calls and hides `io_uring` and `clone3`; everything else stays allowed, and the namespaces, dropped capabilities, `no_new_privs`, and Landlock remain the main barriers.
- **Extra writable roots stay inside the account** — a root a command can influence, such as a linked git worktree's shared directory, is left out when it lies outside the account folder.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: undecided directions and open questions. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

#### Future: preforked interpreters

Measured on the hosted machine, a preloaded pandas and matplotlib process that forks and applies Landlock per command ran a pandas command in 12 ms instead of 381 ms, at about 5 MB per concurrent command instead of 42–50 MB. It needs a per-command interpreter entry point inside the jail and is not decided.

</details>
