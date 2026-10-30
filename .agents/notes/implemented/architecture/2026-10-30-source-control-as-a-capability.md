# Agent Note: Source control is a capability seam

Status: implemented

## Problem

Agents working in a repository had no way to read its state as data. A model that needed to know what was staged, what a change contained, or what landed recently either ran `git` through the shell and parsed progress text, or guessed from the files it had just edited. Committing, switching branches, and merging were shell commands with no structure: a branch switch that would carry uncommitted work failed with an exit code, and a conflicting merge surfaced as a wall of output rather than a list of paths to resolve.

A plugin that wanted the same facts had no seam to call. Adding a `git_*` tool alone would have put the operations and the model-facing schema in one package, so a second engine — or a forge that reports pull requests — could not answer the same calls without changing what the model sees.

## Decision

Source control is one [capability seam](../../../../docs/glossary.md#capability-seam) completing all three roles in a single change:

- **Definition** — `@aeven/vcs` owns `ctx.vcs`: a registry keyed by a branded provider id, repository resolution, and the operations every consumer calls. Registration validates and conflict-checks before mutating, and `ctx.effect` withdraws the provider on disposal, so a rejected registration publishes nothing.
- **Provider** — `@aeven/vcs-git` implements the operations with git through `ctx.subprocess`: porcelain v2 status parsed per side, bounded diffs, commit reading, branch listing and movement, fetch and push, and merge classification.
- **Consumer** — `@aeven/tool-vcs` owns `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_remote`, and `git_merge`: their names, schemas, descriptions, and rendering.

The operations are deliberately a seam rather than a tool-shaped wrapper because they are the part another engine could implement. A forge that reports pull requests, checks, and reviews would register its own provider and expose new Consumer tools; the git provider and the existing tool schemas would not move.

A changed path is reported per side, with `staged` and `worktree` separately, because that is what a checkout holds: a file can be staged modified and modified again afterwards, and one label would lose the fact a commit would miss. An unclassified status character becomes `unknown` rather than a clean side, so a caller cannot read an unfamiliar change as nothing to commit.

Read-only git commands run with `core.hooksPath=/dev/null` and `core.fsmonitor=false`, so a repository-configured program cannot change what a status or diff reports; commands that record history or move the checkout run the repository's own hooks, because there the hooks are the user's policy. Both decisions follow the worktree service, which already treats reports as data.

## Alternatives considered

- **One `git` tool with an operation discriminator.** DeepSeek Harness and t3code both expose structured git through one entry point. A single schema keeps the tool count low, but it puts nine operations in one description and makes every result a union the model must disambiguate; seven named tools say what each returns.
- **A `git` package with no seam.** Fewer packages, and every consumer would depend on git directly. A tool-only design would have made the model-facing schema the only place the operations existed.
- **A forge product: pull requests, reviews, line comments, stacks.** t3code builds one against GitHub. It is a larger surface than the need: an agent that can report changes and record commits does not need to review a diff thread by thread, and forge adapters can register behind the same operations later.
- **Patch-level staging.** `git add -p` needs an interactive patch application the seam does not define; whole-path staging covers the ordinary case.

## Consequences

- A model reads branch, upstream, ahead/behind, changed paths, diffs, history, and merge conflicts as structured values, and asks for stage, commit, branch, fetch, push, and merge as operations.
- A branch switch refuses while tracked files have uncommitted changes unless the caller sets `allowDirty`, turning a git exit code into an instruction the model can act on.
- Bounds are deployment configuration: `statusMaxEntries`, `diffMaxBytes`, `logLimit`, and `logLimitMax` are validated `Config` fields, and every cut result reports `truncated`.
- History rewriting — amend, rebase, reset, revert, cherry-pick, stash — is not exposed; a model that needs it still uses the shell.
- Paths containing newlines are misparsed by the status reader, which splits records by line after splitting on NUL.
- Out-of-process subagent providers and this seam both read a session's recorded directory, so a checkout the session was moved into is honoured and a directory captured at start is not.
