---
description: "The session working directory and workspace root as a logged capability: header cwd overridden by replayable session/cwd changes, resolved by every file, search, shell, and sandbox consumer."
kind: "package-reference"
---

# @aeven/working-directory

English | [中文](README.zh.md)

The session's working directory as a logged capability. Every tool that resolves a relative path asks this service instead of reading the session header.

## Summary

`@aeven/working-directory` answers two questions for the whole harness: which directory is this session working in now, and which workspace may it write? A session is created in a directory recorded in immutable header metadata, but work moves — into a subdirectory, a fresh checkout, a worktree — so the service folds the last logged `session/cwd` over that header and resolves relative paths against the result. File, search, shell, and LSP tools ask it for their working directory, the sandbox policy asks it for the workspace root, and `@aeven/tool-working-directory` exposes the directory to a model. Use it wherever a session's directory must change and survive resume, fork, and replay.

## Table of Contents

- [Contract](#contract)
- [Operations](#operations)
- [Consumers](#consumers)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Contract

A session is created in a directory, and that creation path is immutable header metadata (`SessionHeader.cwd`). Work moves: into a subdirectory, into a fresh checkout, into a worktree. The effective directory is therefore

```
service.of(session)     = last logged session/cwd ?? session.header.cwd
service.rootOf(session) = last logged session/cwd root ?? session.header.cwd
```

`session/cwd` carries the absolute directory and, when the session moved into another workspace, its `root`. It is log-only and non-surface, and replays last-wins for each field, so resume and fork both restore what the log recorded. Changing into a subdirectory leaves the root alone, so it never narrows what the session may write. A session whose header carries no directory and whose log records no change has no working directory, and `of()` returns `undefined` rather than inventing one.

The `workingDirectory` projection unit folds the same events for clients. While the logged directory differs from the header, the service adds one runtime-context line before each request: `Current working directory: "<path>". Relative paths in file, search, and shell calls resolve against it.`, or, when that directory no longer exists, a line saying so.

## Operations

- `of(session)` — the directory in force, or `undefined`.
- `resolve(session, path)` — absolute paths normalize; relative ones resolve against `of()` (falling back to the process directory when the session records none). No filesystem access.
- `rootOf(session)` — the workspace root in force, or `undefined`.
- `change(session, target)` — resolve, require an existing directory, append `session/cwd`, return the absolute path. An empty target, a missing path, or a file throws with a message that names the path. A target already in force appends nothing.
- `enter(session, target)` — like `change`, and the directory also becomes the workspace root. `enterVerified(session, path)` does the same synchronously for a directory the caller has just created, inside a child's creation window.
- `inherit(child, parent)` — copy the parent's logged directory and root onto a child's log, so a delegated child starts where its parent works.

## Consumers

The shell tools (`tool-bash`, `tool-bash-persistent`, `tool-pwsh`, `tool-pwsh-persistent`), the file tools (`tool-fs`), `glob` and `grep` (`tool-fs-search`), `tool-lsp`, `bash-edit-guard`, the terminal panel, and `@`-file references resolve their working directory through `ctx.get('workingDirectory')?.of(session)`, falling back to the header. `@aeven/sandbox-policy` and the workspace file browser take the workspace root from `rootOf()`. A persistent shell spawned in another directory restarts on its next command. The lookup is optional so a composition without this plugin keeps the header behavior.

`@aeven/tool-working-directory` exposes the same capability to the model as `working_directory`; `@aeven/worktrees` moves sessions with `enter()`, and `@aeven/subagent` places children with `inherit()`.

## Known Limitations and Deferred Work

- Project instructions, skill discovery, media, mail, hooks, and out-of-process subagent providers still read `session.header.cwd`, so they keep the creation directory.
- There is no directory stack: `change` is a single last-wins value, so a model that leaves a directory returns by naming the previous path.
- `change` validates that the target exists but does not confine it to a sandbox root. A confined composition must reject a target outside its permitted roots in the policy that owns confinement.

## Dev Note

No invariant companion is published because its one owned relationship — the projection agreeing with `of()` — is observed inside the unit spec on a real session log, and no independent observation exists that could diverge from it.

`of()` returns `undefined` rather than falling back to the process directory, so a session created without a `cwd` is visibly undecided instead of silently inheriting wherever the host happened to start. The tool turns that into an actionable message; `resolve()` is the one place that falls back, and only because a caller asked for a path it needs.

The consumers use `ctx.get('workingDirectory')` rather than a declared injection, because the plugin is optional in a composition: a profile without it keeps the header behavior instead of failing to load.
