---
description: "The ctx.vcs definition package: provider registry, repository resolution, and the normalized status, diff, log, staging, commit, branch, remote, and merge operations every source-control consumer calls, for maintainers composing repository capabilities."
kind: "package-reference"
---

# @aeven/vcs

English | [中文](README.zh.md)

## Summary

`avn-vcs` defines source control as one capability: a `ctx.vcs` service holding registered providers and the operations a caller uses — resolve the repository, report status, diff, log, stage, unstage, commit, list and move branches, fetch, push, and merge. Every report is normalized, so a consumer reads branch, change, and history facts without parsing an engine's output, and a provider that speaks a different engine answers the same calls. Compose it with a provider such as `avn-vcs-git`; on its own the service has no operations to run and fails with `VCS_UNAVAILABLE`.

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

A consumer injects `vcs` and calls an operation with any directory inside a checkout; the service selects a provider, resolves the repository root, and runs the operation against it.

```ts
const status = await ctx.vcs.status(sessionDirectory(ctx, session), exec.signal)
if (status.branch === null) throw new Error('detached HEAD')
```

### Operations

`repository(cwd)` returns the provider and the checkout root. `status` reports branch, upstream, ahead/behind, and changed paths. `diff`, `log`, `stage`, `unstage`, `commit`, `listBranches`, `switchBranch`, `deleteBranch`, `remote`, and `merge` carry out the rest. Requests are plain values: `VcsDiffRequest` (`path`, `staged`, `range`), `VcsCommitRequest` (`message`, `paths`), `VcsSwitchRequest` (`name`, `create`, `from`, `allowDirty`), `VcsRemoteRequest` (`operation`, `remote`, `branch`), and `VcsMergeRequest` (`ref`, `abort`).

### Failures

Every failure is a `VcsError` carrying one stable code: `VCS_UNAVAILABLE` (no provider registered), `VCS_INVALID_PROVIDER` and `VCS_CONFLICT` (registration), `VCS_NOT_A_REPOSITORY` (no provider owns the directory), `VCS_INVALID_REQUEST` (a request the provider refuses before running), `VCS_DIRTY_WORKTREE` (a branch switch that would move uncommitted work), `VCS_CONFLICT_STATE` (a merge left unresolved), and `VCS_COMMAND_FAILED` (the engine refused).

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design notes

- **One role per package.** This package declares the operations and the registry; a provider implements them and a tool Consumer owns the model-facing schemas.
- **Atomic registration.** `registerProvider` validates the id and conflict-checks before mutating; a rejected registration publishes nothing, and `ctx.effect` withdraws the provider on disposal.
- **Detection, not configuration.** Selection asks each provider whether it owns the directory, so a checkout mounted anywhere works without a configured root.
- **Repository root resolution.** Every operation resolves `cwd` to the checkout root first, so a subdirectory or a moved-into worktree behaves like the repository root.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | `Vcs` service, `VcsError`, registration, and operation delegation |
| [`src/types.ts`](src/types.ts) | Report, request, provider, and service types |
| [`src/brand.ts`](src/brand.ts) | The branded provider id |
| — | No runtime invariant companion is published: this package holds a registry and delegates, and the relations it could assert belong to the providers that own checkouts. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Version control subsystem](../../../docs/subsystems/vcs.md) — operations, per-side change reporting, and bounds.
- [avn-vcs-git](../vcs-git/README.md) — the git provider this service selects.
- [avn-tool-vcs](../tool-vcs/README.md) — the model-facing tools.
- [vcs group map](../README.md) — the three-package family.

-----

<a id="model-experience"></a>
## Model Experience

None, as this package contributes no prompt text, tool schema, or result; its values reach the model only through a Consumer.

#### KV Cache effect

Nothing from this service enters a model request, so provider cache reuse is unaffected.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **One provider per directory.** Selection takes the first provider whose `detect` returns a root; nothing arbitrates between two providers claiming one directory, and a second engine for the same directory needs that rule decided first.
- **No forge operations.** Pull requests, reviews, checks, and merge queues are outside this seam; `remote` fetches and pushes only.
- **No conflict resolution verbs.** `merge` reports conflicted paths, but marking a path resolved, choosing a side, and continuing a merge are not operations; a caller commits through the provider once the files are edited.
- **No stash or reset.** The seam has no `stash`, `reset`, `revert`, or `cherry-pick`; a consumer that needs one adds it here, not in a provider.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
