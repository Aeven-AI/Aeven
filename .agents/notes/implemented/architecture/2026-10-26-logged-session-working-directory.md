# Agent Note: A session's working directory is logged state, not header metadata

Status: implemented

English | [中文](2026-10-26-logged-session-working-directory.zh.md)

## Problem

A session is created in a directory and records it in immutable header metadata. Every shell and file tool resolved its working directory from that header, so the directory was fixed for the life of the session: an agent could change directories only by prefixing each call with `cd` inside a shell command, which leaves the next call where it started, and no tool could move a session into a checkout or a worktree.

The port target is DeepSeek Harness's `working_directory` tool and its Git Worktrees plugin. Their session directory is a mutable field; Aeven's is header metadata with a `SESSION_FORMAT_VERSION` pinned at `0` and no compatibility promise. Copying the tool without the state it changes would have produced a tool that reports a directory the rest of the harness ignores.

## Decision

`@aeven/working-directory` owns the effective directory as a capability: a `session/cwd` event records an absolute directory, log-only and non-surface, replayed last-wins, and the service answers

```
of(session) = last logged session/cwd ?? session.header.cwd
```

`resolve` normalizes an absolute path and resolves a relative one against `of()`, so successive changes compose the way a shell's `cd` does. `change` requires an existing directory, appends the event, and returns the absolute path; an empty target, a missing path, or a file throws naming the path, and a target already in force appends nothing.

`@aeven/tool-working-directory` exposes that as the model-facing `working_directory` tool, and the four shell tools resolve through `ctx.get('workingDirectory')?.of(session)` with the header as fallback, so a composition without the plugin behaves exactly as before.

## Alternatives considered

**A mutable field on the session object.** It would mirror the port source most closely, but it is neither durable nor reconstructable: resume would drop it, forks would not inherit it, and a replayed session would act in a directory the log cannot explain. The harness rule is that model-visible state comes from the log.

**A shell-only `cd` persisted in the terminal session.** It covers `bash` and `pwsh` and nothing else — file, search, and MCP tools resolve independently — and it makes the directory a property of a terminal rather than of the session, so a session with two terminals has two answers.

**Put the directory in the request header.** The header is compared for cache-key identity per request; a directory that changes during a turn would invalidate the KV cache for a fact the model never sees. Keeping it out of the request also keeps the prompt unchanged when a session moves.

## Consequences

- `session/cwd` joins the persistence catalog and the known event types; `SESSION_FORMAT_VERSION` stays `0` because no envelope or format changed.
- The projection unit `workingDirectory` exists for clients, so a reloaded or forked session renders the directory the log recorded.
- Consumers that still read `session.header.cwd` directly pin the creation directory. The four shell tools are migrated; file, search, and MCP tools are mechanical follow-ups and are recorded as a limitation in the package README.
- `change` does not enforce sandbox confinement. A confined composition rejects out-of-root targets in the policy that owns confinement, which is where that decision already lives.
- The Git Worktrees work depends on this: `create_worktree` moves the session with `change` after `git worktree add`.
