---
description: "Subprocess runtime for a large Host that starts commands without forking it, for operators running many accounts on one Host."
kind: "package-reference"
---

# @aeven/subprocess-executor

English | [中文](README.zh.md)

## Summary

`avn-subprocess-executor` provides `ctx.subprocess` for a Host that grows large, such as one serving many accounts. Forking a large process copies its page tables, and the Host's event loop serves no one meanwhile: on the hosted machine a 1.2 GB parent took 38.7 ms per command, against 3.2 ms through this runtime, and its event loop stalled 38.9 ms instead of 0.8 ms. It keeps the local runtime's process ownership, output collection, environment scrubbing, and tree signalling, and replaces only how a command starts: a small helper process keeps idle launchers, and a command replaces one of them with `exec`, keeping its pid and process group. A call the pool cannot serve falls back to an ordinary spawn. POSIX only.

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

Mount it in place of [`avn-subprocess-local`](../subprocess-local/README.md); every consumer of `ctx.subprocess` works unchanged. The [hosted bundle](../../bundle/hosted-app/README.md) mounts it on POSIX hosts.

```yaml
- id: subprocess-executor
  name: '@aeven/subprocess-executor'
  config:
    poolSize: 8
```

| Field | Default | Meaning |
|---|---|---|
| `poolSize` | `4` | Idle launchers the helper keeps ready; a burst beyond it falls back to ordinary spawns |

The generated [configuration catalog](../../../docs/config-catalog.md#aevensubprocess-executor) is the exhaustive source for every accepted field and its JSDoc.

### What changes for a command

A command started through a launcher has the same pid, process group, stdio, exit status, and signals as one the local runtime spawns. Its `argv[0]` is the resolved absolute path of the program. A call with an inherited stream, a program that is not executable, or a working directory that does not exist falls back to an ordinary spawn, so its failure is the usual spawn error.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: starts the helper once and installs the pooled spawner into the local runtime |
| [`src/executor.ts`](src/executor.ts) | Host side: the pool of handed-over launchers, the ChildProcess-shaped proxy, and the fallback |
| [`src/worker.ts`](src/worker.ts) | The helper process, bundled as `lib/worker.cjs` |
| — | No runtime invariant companion is published; the runtime keeps the local runtime's process ownership and adds no event sequence a second observation could contradict. |

### One command

The helper starts each launcher as a detached `bash` that blocks reading a script from descriptor 3, and passes its stdin, stdout, stderr, and control pipe to the Host over IPC as open descriptors, then reports its pid. To start a command, the Host takes a ready launcher, writes `cd -- <cwd> && exec /usr/bin/env -i <environment> <program> <args>` to the control pipe, and closes it; the launcher becomes the command. Output streams straight into the Host's collectors through the handed-over pipes. The helper, as the launcher's parent, reports its exit status; signals and tree termination go from the Host to the process group as before.

### Ending

When the Host disposes the runtime, the helper kills the launchers nobody took and exits; it also exits when the Host dies without closing the channel, which it notices by being reparented. If the helper ends while commands run, each is reported killed once its process group is gone, a warning is logged, and a new helper starts; after five ends within a minute the runtime logs that it gives up and starts every command with an ordinary spawn. A launcher that ends before the helper learns the Host took it reports its exit status with its removal, so the command still settles.

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Local subprocess runtime](../subprocess-local/README.md) — the process ownership and teardown this runtime inherits.
- [Executor Agent Note](../../../.agents/notes/implemented/feature/2026-11-06-subprocess-executor.md) — why the Host must not fork per command and how the pool keeps pids synchronous.

-----

<a id="model-experience"></a>
## Model Experience

None, as the runtime changes how processes start, not what any tool returns.

#### KV Cache effect

No direct invalidation; it contributes nothing to requests.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **POSIX only** — it needs `bash`, `/usr/bin/env`, and process groups; Windows hosts keep the local runtime.
- **Idle launchers cost a few megabytes each** — each is a waiting `bash`.
- **Terminals still start from the Host** — `spawnTerminal` allocates a PTY through the local runtime.
- **Running commands end with the helper** — a jailed command runs under `--die-with-parent` with the helper as its parent, so a helper that crashes takes its running commands with it before a new helper takes over.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

This Dev Note is working context for maintainers: undecided directions and open questions. It is explicitly non-authoritative — shipped behavior, limits, and accepted rationale live in the sections above, the package code, and the linked Agent Notes.

None.

</details>
