# Version control

English | [中文](vcs.zh.md)

Source control as a [capability seam](../../docs/glossary.md#capability-seam): one `ctx.vcs` service reports a checkout's branch, changed paths, diffs, and history, and applies the changes a model asks for — stage, commit, branch, fetch, push, merge — without any caller parsing an engine's terminal output. The seam is split across three packages: Service Definition ([avn-vcs](../../packages/vcs/vcs), `ctx.vcs` plus the provider registry), Service Provider ([avn-vcs-git](../../packages/vcs/vcs-git), git through `ctx.subprocess`), and Consumer ([avn-tool-vcs](../../packages/vcs/tool-vcs), the `git_*` tools). Version control is **one optional capability**, not part of the agent-loop spine.

Source: [`packages/vcs/vcs/src/types.ts`](../../packages/vcs/vcs/src/types.ts)

## Why a seam instead of a git tool

A model needs to know what changed and to record changes; it does not need to know which engine records them. Keeping the operations in a Definition means a repository hosted by another engine, or a forge that reports pull requests, can register alongside git without changing a single tool schema or prompt. The tool Consumer owns every model-visible word; a provider owns only how an operation is carried out.

## Operations

Paths in every report are repository-relative with POSIX separators, and every operation accepts any directory inside a checkout: the provider resolves the repository itself and runs against its root. That keeps a call working from a subdirectory and from a worktree a session was moved into.

| Operation | Report or effect |
|---|---|
| `detect` | The checkout root a directory belongs to, or null |
| `status` | Branch, upstream, ahead/behind, and each changed path with its staged and unstaged change |
| `diff` | Unified diff of the working tree against the index, the index against HEAD, or two revisions |
| `log` | Recent commits with hash, author, date, and subject |
| `stage` / `unstage` | Index entries for named paths |
| `commit` | A commit of the index, optionally staging named paths first |
| `listBranches` / `switchBranch` / `deleteBranch` | Local branches and the checkout's branch |
| `remote` | Fetch or push |
| `merge` | A merge into the checked-out branch, or an abort, with conflicted paths |

## Changes are reported per side

A path is one entry with two sides, because that is what a checkout actually holds: a file can be staged as modified and modified again afterwards. Collapsing it to one label loses the fact a commit would miss.

```ts type-equiv
/** One changed path, with each side of the checkout reported separately. */
interface VcsChange {
  /** Repository-relative path, POSIX separators. */
  readonly path: string
  /** Staged change in the index, or null when the index matches the revision for this path. */
  readonly staged: VcsChangeKind | null
  /** Unstaged change in the working tree, or null when the file matches the index. */
  readonly worktree: VcsChangeKind | null
}
```

An unclassified status code becomes `unknown` rather than a clean side, so a caller never reads an unfamiliar change as "nothing to commit".

## Bounds and failures

Status keeps at most `statusMaxEntries` paths, a diff is cut at `diffMaxBytes`, and both say so through `truncated`. Every bound is a validated `Config` field. Failures are `VcsError` with a stable code — `VCS_NOT_A_REPOSITORY`, `VCS_DIRTY_WORKTREE`, `VCS_CONFLICT`, `VCS_INVALID_REQUEST`, `VCS_COMMAND_FAILED`, `VCS_UNAVAILABLE`, `VCS_INVALID_PROVIDER`, `VCS_CONFLICT_STATE` — so a tool can turn "the switch would carry uncommitted changes" into an instruction instead of a failed command.

## Provider rules

A provider reserves a branded id atomically: registration validates and conflict-checks before it mutates, and its disposer withdraws the whole provider. Selection asks each registered provider whether it owns the directory, so a directory only one provider accepts never depends on registration order.

The git provider runs read-only commands with `core.hooksPath=/dev/null` and `core.fsmonitor=false`, so a repository-configured program cannot change what a status or diff reports; commands that record history or move the checkout run the repository's own hooks, because there they are the user's policy.

## Related

- [avn-vcs](../../packages/vcs/vcs/README.md) — the Definition.
- [avn-vcs-git](../../packages/vcs/vcs-git/README.md) — the git provider.
- [avn-tool-vcs](../../packages/vcs/tool-vcs/README.md) — the model-facing tools.
- [Source control as a capability Agent Note](../../.agents/notes/implemented/architecture/2026-10-30-source-control-as-a-capability.md) — alternatives and what stays deferred.

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxvcs--vcsservice"></a>

### `ctx.vcs` — `VcsService`

`ctx.vcs`: the checkout operations over whichever provider handles the directory, plus the registration that supplies them.

```ts cordis-catalog
/**
 * Reserve a provider id and the operations it implements.
 * @param provider - the implementation to publish.
 * @returns the disposer that withdraws it.
 */
registerProvider(provider: VcsProvider): () => void

/**
 * Select the provider that handles a directory and resolve its repository.
 * @param cwd - any directory inside a checkout.
 * @param signal - cancels detection.
 * @returns the provider and the absolute repository root.
 */
repository(cwd: string, signal?: AbortSignal): Promise<{ provider: VcsProvider; repositoryRoot: string }>
```

Source: [`packages/vcs/vcs/src/types.ts`](../../packages/vcs/vcs/src/types.ts)
<!-- END GENERATED cordis-surface -->
