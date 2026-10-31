---
description: "The git provider for ctx.vcs: repository detection and normalized status, diff, log, staging, commit, branch, remote, and merge operations through ctx.subprocess, with bounded output and structured failures, for maintainers running source control on git."
kind: "package-reference"
---

# @aeven/vcs-git

English | [中文](README.zh.md)

## Summary

`avn-vcs-git` implements `ctx.vcs` with git: it detects the checkout a directory belongs to, reads porcelain v2 status into per-path staged and unstaged changes, renders bounded diffs, lists commits and branches, and stages, commits, moves branches, fetches, pushes, and merges. Output is collected through `ctx.subprocess` and parsed as data, so no caller depends on git's progress text. Read-only reports run with repository hooks and fsmonitor disabled; commands that record history or move the checkout run the repository's own configuration.

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

Load the plugin beside the `avn-vcs` definition. It registers one provider with the id `git` and needs no other configuration than its bounds.

```yaml
- id: vcs-git
  name: '@aeven/vcs-git'
  config:
    graceMs: 5000
    outputMaxBytes: 1000000
    diffMaxBytes: 200000
    logLimit: 20
    logLimitMax: 100
    statusMaxEntries: 2000
```

### Configuration

| Key | Default | Meaning |
|---|---|---|
| `graceMs` | `5000` | Grace a git child gets between termination signals |
| `outputMaxBytes` | `1000000` | Largest stdout tail retained for one command; a longer stream is cut and reported as truncated |
| `diffMaxBytes` | `200000` | Largest diff returned; a longer diff is cut and marked `truncated` |
| `logLimit` | `20` | Commit count reported when a request omits one |
| `logLimitMax` | `100` | Largest commit count a request may ask for |
| `statusMaxEntries` | `2000` | Largest number of changed paths one status report keeps |

The generated [configuration catalog](../../../docs/config-catalog.md) is the exhaustive source for every accepted field.

### Behavior worth knowing

`switchBranch` refuses while tracked files have uncommitted changes, with `VCS_DIRTY_WORKTREE`, unless the request sets `allowDirty`; git itself would then still refuse a switch that would overwrite them. `commit` with `paths` stages those paths first, and a commit with nothing staged fails as `VCS_INVALID_REQUEST` instead of an opaque exit status. `merge` returns `conflicted` with the unmerged paths rather than only git's exit code, and `abort` discards a merge in progress.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design notes

- **Hooks and fsmonitor off for reports.** Detection, status, diff, log, and the dirty check pass `-c core.hooksPath=/dev/null -c core.fsmonitor=false`, so a repository-configured program cannot change what a report says. Staging, committing, branch movement, fetch, push, and merge run unmodified, because there the hooks are the user's policy.
- **Porcelain v2, per side.** Status uses `--porcelain=v2 --branch -z`; each path keeps its index and work-tree characters separately, and an unclassified character becomes `unknown` instead of a clean side. A type-2 record's original path arrives as its own NUL-separated record and is consumed, not misread as a path.
- **Bounded output, honest truncation.** Every spawn collects a bounded tail; a cut stream sets `stdoutTruncated`, and a diff longer than `diffMaxBytes` is sliced and marked `truncated`.
- **No shell.** Every command is an argv array, so a message, path, or revision that looks like shell syntax stays one argument.
- **Empty history is not a failure.** `log` in a repository with no commits returns no commits; `unstage` before the first commit falls back to dropping index entries, because there is no HEAD to restore from.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Provider implementation, `Config`, and registration |
| [`src/git.ts`](src/git.ts) | Bounded spawn, read-only flagging, and failure construction |
| [`src/parse.ts`](src/parse.ts) | Porcelain v2 status, log, branch, and path-list parsers |
| — | No runtime invariant companion: checkout state belongs to the repository, and the provider owns no state of its own that another package could observe diverging. |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Version control subsystem](../../../docs/subsystems/vcs.md) — the operations and their normalized values.
- [avn-vcs](../vcs/README.md) — the definition this provider implements.
- [avn-tool-vcs](../tool-vcs/README.md) — the tools that call it.
- [vcs group map](../README.md) — the three-package family.

-----

<a id="model-experience"></a>
## Model Experience

Indirectly, through `avn-tool-vcs`, which renders the change records this backend produces.

#### KV Cache effect

The backend returns change records a Consumer renders; it appends nothing to a request, so an existing prefix stays reusable.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Paths with newlines are misparsed.** Status splitting treats a newline inside a path as a record boundary; the bound formats (`-z`) carry such paths verbatim, and supporting them needs a parser that tracks path boundaries instead of splitting lines.
- **Merge conflicts are reported, not resolved.** The provider lists unmerged paths; editing them and continuing is the caller's work, and a `--continue` verb does not exist yet.
- **The dirty guard covers tracked files only.** Untracked files do not block a switch, matching git's own refusal rules closely enough for a checkout, and a request that needs a stricter rule sets `allowDirty` off and checks status itself.
- **`remote` needs working credentials.** Fetch and push run in the host's environment with no credential management of their own, so a private remote fails as `VCS_COMMAND_FAILED` with git's own message.
- **No partial staging.** `stage` takes whole paths; staging a hunk of a file needs a patch-application verb the seam does not define.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

No runtime invariant companion is published: every answer is derived from the repository on disk through `ctx.subprocess`, so a second observation would repeat the same read.

</details>
