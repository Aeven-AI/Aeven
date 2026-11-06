# Agent Note: Start commands without forking the Host

Status: implemented

English | [中文](2026-11-06-subprocess-executor.zh.md)

## Problem

On Linux, Node's `child_process.spawn` forks the calling process, and a fork copies the parent's page tables before the child can `exec`. The hosted Host holds the sessions, memory, and sync state of every account and measured 1.2 GB; spawning from a parent that size took 38.7 ms per command, and the Host's event loop was blocked for 38.9 ms of it. Every bash command, jailed or not, paid that, and every account's requests waited while it happened, so the cost grows with both the Host's size and the number of people running commands.

## Decision

`@aeven/subprocess-executor` is a `ctx.subprocess` provider that extends `avn-subprocess-local` and replaces only its injectable spawner. The Host forks once, at load, to start a small helper process. The helper keeps a pool of idle launchers: each is a detached `bash` blocked reading a script from descriptor 3. The helper passes each launcher's stdin, stdout, stderr, and control pipe to the Host over IPC as open descriptors and reports its pid. To start a command, the Host takes a ready launcher, writes `cd -- <cwd> && exec /usr/bin/env -i <environment> <program> <args>` to the control pipe, and closes it; the launcher becomes the command with the same pid and process group. The Host returns a ChildProcess-shaped proxy whose pid is available at once, as the local runtime requires, whose output arrives through the handed-over pipes, and whose exit status the helper reports. Signals and tree termination go from the Host to the process group as before. A call the pool cannot serve — no ready launcher, an inherited stream, a program that is not executable, a missing directory — falls back to an ordinary spawn, so spawn failures keep their errors.

The hosted patch mounts it with a pool of eight on POSIX hosts in place of the local runtime.

A helper that ends is restarted, with a warning, up to five times a minute before the runtime stays on ordinary spawns; a launcher that ends before the helper learns the Host took it reports its exit status with its removal, so the command settles. Launchers read their script with one `cat` rather than bash's byte-at-a-time `read`, and the video extractor starts `ffprobe` through `ctx.subprocess`, so it no longer forks the Host either. A helper error counts as the helper ending, a replaced helper's late messages are dropped with their descriptors, and a command whose helper ended has its streams closed once its process group is gone, so no tool call waits on a helper that is gone.

## Alternatives considered

Re-implementing `ctx.subprocess` over IPC, as the E2B adapters do, was rejected: the local runtime's collection, spill, and teardown logic would be duplicated, and a remote spawn cannot publish a pid synchronously. Replacing `spawn` with a native `posix_spawn` or `vfork` binding was rejected as a new native dependency for one call. A Node launcher using `process.execve` would work but costs tens of megabytes per idle launcher; a waiting `bash` costs a few.

## Consequences

Starting a command no longer blocks the Host: on the hosted machine, from a 1.2 GB parent, a command started in 3.2 ms instead of 38.7 ms and the worst event-loop stall fell from 38.9 ms to 0.8 ms. Terminals still allocate their PTY from the Host. A preloaded Python interpreter that avoids per-command imports is separate work.

## Verification

A source-level run of the provider in a Cordis context, on macOS and on the hosted machine, checked collected stdout and stderr with exit codes, working directory and environment with PATH lookup, piped stdin, tree termination on abort, the fallback for a missing program, and bounded collection of 3 MiB of output, and measured both runtimes from a 1.2 GB parent. Typecheck and build pass.
