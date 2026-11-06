# Agent Note: Jailed python3 runs in a preloaded interpreter

Status: implemented

English | [中文](2026-11-06-hosted-python-zygote.zh.md)

## Problem

On hosted Web, every `python3` a jailed command ran started a fresh interpreter and imported its libraries again: `import pandas, matplotlib.pyplot` took about 0.9 s per call on the hosted machine, and a chart or spreadsheet task makes many such calls. Each concurrent run also held its own 40–50 MB copy of those modules.

## Decision

`avn-sandbox-jail` gains `pythonZygote`. The provider starts one interpreter of the image, outside every jail, in its own cgroup `<root>/zygote`, and restarts it when it ends (five times a minute at most). It imports `preload` once and serves a `SOCK_SEQPACKET` socket in `socketDir`, which every jail mounts read-only at `/run/aeven/zygote`. `host/install-python-zygote.sh` builds a static `python3` (and `python`) shim into `/opt/aeven-sandbox/shim`, first on the jail's `PATH`. The shim sends its argv, environment, umask, working directory, and open descriptors with their numbers. The zygote plans the call without forking; a call it cannot reproduce exactly answers `F`, and the shim executes the image's interpreter with the same argv. Such calls include an interactive session, an unusual flag, a changed `PYTHON*`, locale, thread-count, or Matplotlib variable, or `-c` code that names no preloaded module. Otherwise a helper fork identifies the caller by the socket's peer pidfd, refuses one outside an `acct-*` group or sharing the zygote's user namespace, joins the caller's account group, and then joins the caller's user, mount, IPC, UTS, network, cgroup, and PID namespaces. The run is forked into that PID namespace. It drops every capability, sets `no_new_privs`, installs the launcher's Landlock rules (read beneath `/`; write to `/dev/null`, `/dev/shm`, and, when the jail mounts writable roots, `/tmp` and those roots, read from its own mount table), loads the jail's seccomp filter, and runs the program. The shim relays signals and the exit status; the run dies with the caller's jail.

## Alternatives considered

A zygote inside each account's own long-lived jail was rejected: its `/tmp` and PID namespace would differ from the command's, so `echo > /tmp/x; python3 x.py` and `timeout` would break. Leaving every call on the zygote was rejected: a fork of the preloaded interpreter costs more than starting a bare one for code that imports nothing heavy. A Python shim was rejected because its own start-up would cost most of the gain.

## Consequences

On the hosted machine, `import pandas, matplotlib.pyplot` takes about 30 ms instead of 0.9 s, a numpy script 30 ms instead of 99 ms, and plain code keeps the interpreter's 13 ms. Runs from one zygote share its string-hash seed and report parent pid 0; the README lists this. Nothing security-relevant comes from the request: the namespaces, cgroup, and writable roots are the kernel's view of the caller.

## Verification

Typecheck, lint, duplication, and build pass. In a delegated transient unit on the hosted machine, jailed runs through the zygote showed zero capabilities, `NoNewPrivs` 1, and seccomp mode 2. The Host's files stayed hidden, system paths read-only, `/dev` and read-only-mode `/tmp` denied, and the network unreachable. `/tmp` was shared with the calling shell, and exit statuses, `timeout`, stdin programs, scripts, `-m`, process substitution, Matplotlib output, per-run randomness, threads and `atexit`, and multiprocessing spawn and fork all behaved as the interpreter does.
