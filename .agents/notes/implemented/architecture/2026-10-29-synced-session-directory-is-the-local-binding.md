# Agent Note: A synced session's directory is this device's workspace binding, not its recorded path

Status: implemented

English | [中文](2026-10-29-synced-session-directory-is-the-local-binding.zh.md)

## Problem

`SessionHeader.cwd` and every `session/cwd` event record an absolute path in the spelling of the device that wrote them, and every shell, file, search, LSP, and sandbox consumer resolved from those values. Workspaces, meanwhile, sync identity only: `@aeven/workspace` publishes a workspace's title and order through the account's synced document and never its directory, so a workspace that arrives on another device is `remote` until that device binds a folder of its own.

Sessions sync. So a conversation created on one machine reaches another carrying the first machine's directory in its header and in its log, and tools on the receiving machine act on that path. The failure is not cosmetic: the path may be absent, in which case every relative tool call fails, or it may exist and name an unrelated directory, in which case the session reads and writes the wrong files. The sandbox's `workspace-write` boundary is derived from the same value, so the confinement root was wrong too.

Handover made it permanent. `claimRunnerAccount()` applied the local workspace by calling `WorkingDirectoryService.enter()`, which appends a `session/cwd` event — writing this machine's absolute path into a log that syncs back to every other device.

## Decision

Workspace identity is the portable fact; the directory is device-local. `@aeven/working-directory` resolves a session's local directory from the workspace registry instead of reading the recorded path, and the recorded path is never used where no local binding exists.

`WorkspaceRegistry` publishes the two reads the resolver needs: `placeSession(sessionId)` returns `{ state: 'filed', workspace }`, `{ state: 'pending', home }` for an imported session whose workspace has not arrived, or `{ state: 'unfiled' }`; `replicated(sessionId)` reports whether the log came from another device.

`WorkingDirectoryService.local(session)` answers with the pair this device acts in:

| Session | Local directory |
|---|---|
| Records no directory (a workspace-less chat) | `absent` |
| Workspace not on this device yet | `unresolved('workspace-not-here')` |
| Workspace here without a directory | `unresolved('workspace-unbound')` |
| Workspace bound here, log written by another device | the binding, as both directory and root |
| Workspace bound here, log written here | the recorded pair |
| No workspace accounts it here | the recorded pair |

`of()` and `rootOf()` return the local pair or `undefined`; they never return another device's path. `resolve()` refuses rather than falling back to the process directory. Two exported helpers carry the rule to consumers: `sessionDirectory(ctx, session)` and `sessionWorkspaceRoot(ctx, session)` throw `WorkingDirectoryUnavailableError` when the workspace has no folder here, and fall back to `header.cwd` only when the plugin is not composed at all. A directory this process entered itself — `change`, `enter`, `enterVerified` — outranks the binding for a replicated session and lives for the process, because the log carries the move for the next one.

Handover writes nothing. `claimRunnerAccount()` resolves the local directory after it claims a session and refuses with `workspace/no-local-directory` (details carry the session, the workspace, and the reason) when there is none; it no longer calls `enter()`. The local directory is derived at execution time, so there is nothing to record.

### What stays on the header

Values used to *compare* or to *label* a session keep reading `SessionHeader.cwd`, because a recorded directory is still the right answer to "which workspace did this come from": workspace membership and admission, ACP session metadata, session-reference ranking, the procedural-memory scope, and the registry's own cwd validation. The change is about where a tool acts, not about what a session is.

## Alternatives considered

**Synchronize the directory path.** Publishing a workspace's path through the account document would let every device read the same absolute path, which is exactly the outcome to avoid: two machines cannot share one spelling, and the last writer would overwrite the other's binding.

**Rewrite session headers on arrival.** It would make the recorded path locally true, but it destroys the portable record, needs a migration over existing logs, and breaks the header's immutability contract — while still leaving every other device's copies to rewrite on their own arrival.

**Fall back to the recorded path when it happens to exist.** Cheap and wrong: two directories with the same spelling are not the same directory, so a coincidental match would run the session against unrelated files. Existence is also not evidence of ownership, which is why the rule refuses instead.

**Have `of()` return `undefined` and let each consumer keep its `?? session.header.cwd`.** That is the state this change replaces: the capability answers "no local directory", the consumer resurrects the foreign one, and the bug survives in every call site that was not migrated.

**A local override database beside the workspace record.** The workspace record already *is* the local binding; a second store would have to be kept in agreement with it.

## Consequences

- A synced conversation opens and runs on a second device against that device's own folder for the same workspace, and never against the first device's path.
- A workspace that arrived without a directory refuses local file and shell work with a typed error and a prompt-side line telling the model to ask which folder to use, instead of failing on missing paths or writing somewhere unrelated.
- `@aeven/working-directory` reads `@aeven/workspace` optionally: a composition without the registry (subagents, snapshot replay, the SDK) keeps resolving from the header, where no synced session can reach it.
- A cloned copy of a session is claimed without writing to its log, so the handover no longer carries a machine-specific path to other devices.
- Relinking a moved folder, and carrying the subdirectory a replicated session worked in, are not part of this decision; both are recorded as current limits in the package README.
- The resolver calls `placeSession` on every directory read, which walks the registry's workspace list. That is a per-call cost in the tool path and a candidate for caching if it shows up in profiles.
