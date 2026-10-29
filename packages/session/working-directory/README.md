---
description: "The session working directory and workspace root as a logged capability: header cwd overridden by replayable session/cwd changes, resolved to this device's workspace binding for every file, search, shell, and sandbox consumer."
kind: "package-reference"
---

# @aeven/working-directory

English | [中文](README.zh.md)

The session's working directory as a logged capability. Every tool that resolves a relative path asks this service instead of reading the session header.

## Summary

`@aeven/working-directory` answers two questions for the whole harness: which directory is this session working in now, and which workspace may it write? A session is created in a directory recorded in immutable header metadata, but work moves — into a subdirectory, a fresh checkout, a worktree — so the service folds the last logged `session/cwd` over that header and resolves relative paths against the result. File, search, shell, and LSP tools ask it for their working directory, the sandbox policy asks it for the workspace root, and `@aeven/tool-working-directory` exposes the directory to a model. Use it wherever a session's directory must change and survive resume, fork, and replay.

Those recorded paths name a directory on the device that wrote them. A session of a synced account reaches other devices, where the path may not exist and may name an unrelated directory of the same spelling, so the service resolves against the local workspace registry: the shared workspace identity is the portable fact, and the directory is this device's binding for it ([decision](../../../.agents/notes/implemented/architecture/2026-10-29-synced-session-directory-is-the-local-binding.md)).

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
recorded = last logged session/cwd ?? session.header.cwd        // written where the session ran
service.local(session) = local binding for the session's workspace, when this device has one
```

`session/cwd` carries the absolute directory and, when the session moved into another workspace, its `root`. It is log-only and non-surface, and replays last-wins for each field, so resume and fork both restore what the log recorded. Changing into a subdirectory leaves the root alone, so it never narrows what the session may write.

Resolution reads two facts: the recorded pair, and where `ctx.workspaceRegistry.placeSession(sessionId)` says the session sits on this device. A session this device wrote keeps its recorded directory, which is where its work is — a subdirectory, a checkout, a worktree. A session replicated from another device acts in this device's binding for its workspace, because the recorded path belongs to the machine that wrote it. A session whose workspace reached this device without a directory, or has not arrived yet, resolves to no directory and says why; the recorded path is never used in place of a missing binding. A session that records no directory at all (a workspace-less chat) has none here either, and `of()` returns `undefined` rather than inventing one.

The `workingDirectory` projection unit folds the same events for clients. While a local directory is in force, the service adds one runtime-context line before each request: `Current working directory: "<path>". Relative paths in file, search, and shell calls resolve against it.` — or a line saying that directory no longer exists. When this device cannot honour the session's workspace, the line says so and asks the model to settle on a folder instead of guessing.

## Operations

- `local(session)` — the local directory and root, `{ state: 'unresolved', reason }` when this device has no folder for the session's workspace (`workspace-unbound`, `workspace-not-here`), or `{ state: 'absent' }` when the session records no directory. No filesystem access.
- `of(session)` / `rootOf(session)` — the local directory and workspace root, or `undefined`; read `local()` to tell a refusal from a session that records none.
- `resolve(session, path)` — absolute paths normalize; relative ones resolve against the local directory. A session whose workspace has no local folder throws `WorkingDirectoryUnavailableError` instead of resolving against the process directory. No filesystem access.
- `change(session, target)` — resolve, require an existing directory, append `session/cwd`, return the absolute path. An empty target, a missing path, or a file throws with a message that names the path. A target already in force appends nothing.
- `enter(session, target)` — like `change`, and the directory also becomes the workspace root. `enterVerified(session, path)` does the same synchronously for a directory the caller has just created, inside a child's creation window.
- `inherit(child, parent)` — copy the parent's logged directory and root onto a child's log, so a delegated child starts where its parent works. A parent working through this device's binding logs nothing: the child's own header already names this device's directory, and copying the parent's recorded path would carry another machine's spelling into the child's synced log.

## Consumers

Consumers call one of two exported helpers, never the header:

- `sessionDirectory(ctx, session)` — the directory a file, search, shell, LSP, media, terminal, hook, or subagent call acts in.
- `sessionWorkspaceRoot(ctx, session)` — the root that confines writes, used by `@aeven/sandbox-policy`, the workspace file browser, and `@`-file references.

Both throw `WorkingDirectoryUnavailableError` when the session's workspace has no local folder, and fall back to the header only when this plugin is not composed at all — a composition with no workspace registry, and therefore no synced sessions either. The shell tools (`tool-bash`, `tool-bash-persistent`, `tool-pwsh`, `tool-pwsh-persistent`), file tools (`tool-fs`), `glob`/`grep` (`tool-fs-search`), `tool-lsp`, `tool-media`, `bash-edit-guard`, the terminal panel, the workspace file browser, project instruction discovery, project context, hooks, and the Codex subagent provider all resolve through them. A persistent shell spawned in another directory restarts on its next command.

`@aeven/tool-working-directory` exposes the same capability to the model as `working_directory`; `@aeven/worktrees` moves sessions with `enter()`, and `@aeven/subagent` places children with `inherit()`.

## Known Limitations and Deferred Work

- **Relinking a moved folder is not available yet.** A workspace whose directory moved resolves to the stale binding; `WorkspaceRegistry.bind()` accepts only a workspace that has no directory on this device, so the record must be recreated or the folder restored until relink ships.
- **A replicated session runs at its workspace root.** Recording where inside the workspace a session works as a workspace-relative path is not implemented, so a session replicated from another device acts in the binding itself rather than in the subdirectory it last used.
- **A device-local relocation is not portable.** A worktree or a directory the session entered outside its workspace is this device's own; the move lives in this process for a replicated session and in the log for one this device wrote.
- **Identity reads stay on the header.** Session grouping, session-reference ranking, ACP session metadata, the procedural-memory scope, and the workspace registry's own cwd validation compare recorded directories rather than acting in one, so they keep reading `session.header.cwd` deliberately.
- There is no directory stack: `change` is a single last-wins value, so a model that leaves a directory returns by naming the previous path.
- `change` validates that the target exists but does not confine it to a sandbox root. A confined composition must reject a target outside its permitted roots in the policy that owns confinement.

## Dev Note

No invariant companion is published because its one owned relationship — the projection agreeing with `of()` — is observed inside the unit spec on a real session log, and no independent observation exists that could diverge from it.

`of()` returns `undefined` rather than falling back to the process directory, so a session created without a `cwd` is visibly undecided instead of silently inheriting wherever the host happened to start. `resolve()` refuses the same case rather than resolving a relative path against the process directory.

The consumers look the service up with `ctx.get('workingDirectory')` rather than declaring an injection, because the plugin is optional in a composition: a profile without it keeps the header behavior instead of failing to load.
