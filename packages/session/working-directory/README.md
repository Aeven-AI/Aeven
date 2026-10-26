---
description: "The session working directory as a logged capability: header cwd overridden by replayable session/cwd changes, with resolve and change operations over the shell tools' working directory."
kind: "package-reference"
---

# @aeven/working-directory

English | [中文](README.zh.md)

The session's working directory as a logged capability. Every tool that resolves a relative path asks this service instead of reading the session header.

## Summary

`@aeven/working-directory` answers one question for the whole harness: which directory is this session working in now? A session is created in a directory recorded in immutable header metadata, but work moves — into a subdirectory, a fresh checkout, a worktree — so the service folds the last logged `session/cwd` over that header and resolves relative paths against the result. Shell tools ask it for their working directory, and `@aeven/tool-working-directory` exposes the same capability to a model. Use it wherever a session's directory must change and survive resume, fork, and replay.

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
service.of(session) = last logged session/cwd ?? session.header.cwd
```

`session/cwd` carries the absolute directory, is log-only and non-surface, and replays last-wins, so resume and fork both restore the directory the log recorded. A session whose header carries no directory and whose log records no change has no working directory, and `of()` returns `undefined` rather than inventing one.

The `workingDirectory` projection unit folds the same events for clients.

## Operations

- `of(session)` — the directory in force, or `undefined`.
- `resolve(session, path)` — absolute paths normalize; relative ones resolve against `of()` (falling back to the process directory when the session records none). No filesystem access.
- `change(session, target)` — resolve, require an existing directory, append `session/cwd`, return the absolute path. An empty target, a missing path, or a file throws with a message that names the path. A target already in force appends nothing.

## Consumers

`tool-bash`, `tool-bash-persistent`, `tool-pwsh`, and `tool-pwsh-persistent` resolve their working directory through `ctx.get('workingDirectory')?.of(session)`, falling back to the header. The lookup is optional so a composition without this plugin keeps the header behavior.

`@aeven/tool-working-directory` exposes the same capability to the model as `working_directory`.

## Known Limitations and Deferred Work

- Only the four shell tools plus this package's tool resolve through the service. File, search, and MCP tools that read `session.header.cwd` directly still pin the creation directory; moving them onto `ctx.get('workingDirectory')?.of(session)` is mechanical and belongs with the worktree work that needs it.
- There is no directory stack: `change` is a single last-wins value, so a model that leaves a directory returns by naming the previous path.
- `change` validates that the target exists but does not confine it to a sandbox root. A confined composition must reject a target outside its permitted roots in the policy that owns confinement.

## Dev Note

The service publishes no `./invariant` companion. Its one owned relationship — the projection agreeing with `of()` — is observed inside the unit spec on a real session log, and no independent observation exists that could diverge from it.

`of()` returns `undefined` rather than falling back to the process directory, so a session created without a `cwd` is visibly undecided instead of silently inheriting wherever the host happened to start. The tool turns that into an actionable message; `resolve()` is the one place that falls back, and only because a caller asked for a path it needs.

The consumers use `ctx.get('workingDirectory')` rather than a declared injection, because the plugin is optional in a composition: a profile without it keeps the header behavior instead of failing to load.
