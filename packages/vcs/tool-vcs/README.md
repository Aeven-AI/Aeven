---
description: "The model-facing source-control tools for ctx.vcs: git_status, git_diff, git_log, git_commit, git_branch, git_remote, and git_merge, with per-path staged and unstaged reporting, bounded diffs, and structured merge conflicts, for maintainers composing model repository work."
kind: "package-reference"
---

# @aeven/tool-vcs

## Summary

`avn-tool-vcs` gives the model seven source-control tools over the `ctx.vcs` seam: read the checkout's branch and changed paths, read a diff or recent history, commit, list and move branches, fetch or push, and merge. Each tool resolves the calling session's directory, so a call finds the repository the session actually edits — including a worktree the session was moved into — and reports normalized values rather than git's progress text. The tools own every model-visible name, schema, and rendering; the provider owns only execution.

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

Load the plugin beside `avn-vcs` and a provider such as `avn-vcs-git`; it takes no configuration.

### The tools

| Tool | Input | Returns |
|---|---|---|
| `git_status` | — | Repository, branch or detached HEAD, upstream with ahead/behind counts, and each changed path with its staged and unstaged change |
| `git_diff` | `path`, `staged`, `range` | Unified diff of the working tree against the index by default, the index against HEAD with `staged`, or two revisions with `range`, plus a truncation flag |
| `git_log` | `limit` | Recent commits with hash, author, date, and subject |
| `git_commit` | `message`, `paths` | The created commit; `paths` are staged first, and omitting them commits the index as it stands |
| `git_branch` | `operation`, `name`, `from`, `allow_dirty`, `force` | Branch list with the current one flagged, the branch now checked out, or the deleted branch |
| `git_remote` | `operation`, `remote`, `branch` | The command's own output |
| `git_merge` | `ref`, `abort` | Outcome (`merged`, `conflicted`, `up-to-date`, `aborted`), conflicted paths, and git's output |

### What the model gets back

`git_status` renders one line per changed path, naming each side — `modified staged`, `modified unstaged`, or both — and says when more paths exist than are listed. `git_diff` renders the diff, or `no differences`; a cut diff carries an explicit truncation marker. `git_merge` names the outcome first and lists conflicted paths under it.

### Failures and recovery

A tool call fails when the session has no directory, when no provider owns the directory (`VCS_NOT_A_REPOSITORY`), when a switch would move uncommitted changes (`VCS_DIRTY_WORKTREE`), and when git refuses (`VCS_COMMAND_FAILED`). Each surfaces as an error tool result the model can read and act on: commit before switching, narrow a diff with `path`, or resolve the listed conflicts and commit.

-----

<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>Implementation internals — click to expand</summary>

### Design notes

- **Session-derived directory.** Every tool resolves `sessionDirectory(ctx, session)` and fails loudly without one, so the tools follow a session moved into a worktree instead of a path captured at registration.
- **Seam values in, seam values out.** Tools map the seam's camelCase values to schema fields and back; `VcsDiff.text` becomes `diff` and `VcsMergeResult.conflicts` is copied, so a schema never exposes a readonly array.
- **Primitive tool schemas.** The model sends only task-relevant inputs; remote names, revisions, and paths stay arguments rather than configuration, and every bound lives on the provider.
- **Renderers state facts, not tone.** Status says `working tree clean`, diffs say `no differences`, and merges name their outcome before listing paths.

### Source map

| File | Role |
|---|---|
| [`src/index.ts`](src/index.ts) | Plugin entry: the seven tool definitions, renderers, and execution |

</details>

-----

<a id="further-exploration"></a>
## Further Exploration

- [Version control subsystem](../../../docs/subsystems/vcs.md) — operations and normalized values.
- [avn-vcs](../vcs/README.md) — the definition these tools call.
- [avn-vcs-git](../vcs-git/README.md) — the provider that answers.
- [vcs group map](../README.md) — the three-package family.

-----

<a id="model-experience"></a>
## Model Experience

### System prompt

None.

#### What the model sees

No prompt section; each tool's description carries its own usage guidance.

#### Token effect

Fixed schema cost per request, described under Tool schema.

#### KV Cache effect

None from a prompt prefix.

### Tool schema

#### What the model sees

Seven tool schemas: `git_status`, `git_diff`, `git_log`, `git_commit`, `git_branch`, `git_remote`, `git_merge`, as listed in the generated [`git_*` catalog entries](../../../docs/tool-catalog.md).

#### Token effect

Fixed cost on every request while the plugin is active; the largest is `git_branch`, whose five parameters cover four operations.

#### KV Cache effect

Prefix-stable while the visible definitions and their order are unchanged; registration or disposal may invalidate reuse from the first changed schema token.

### Results

#### What the model sees

Per-path status lines with each side named, unified diffs with an explicit truncation marker, commit lines, branch lists with the current branch marked, remote output, and merge outcomes with conflicted paths. Empty results say so — `working tree clean`, `no differences`, `no commits yet`.

#### Token effect

Bounded by the provider's `diffMaxBytes`, `statusMaxEntries`, and `logLimitMax`; each bound reports its own truncation rather than returning a smaller-looking complete value.

#### KV Cache effect

Tool results append after the cached request prefix and do not directly invalidate it.

### UI presentation

#### What the model sees

Nothing. No call or result presenter is registered, so the client renders these tools from their raw results.

#### Token effect

None; presentation is client-side.

#### KV Cache effect

None.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **No history rewriting.** Amend, rebase, reset, revert, cherry-pick, and stash are not tools; a model that needs them uses the shell, which also means the tools cannot guide or bound that work.
- **One tool per operation family.** `git_branch` multiplexes four operations to keep the schema count low, at the cost of a longer description and an `operation` discriminator the model must set correctly.
- **No file-level conflict resolution.** `git_merge` reports conflicted paths; editing them happens through the file tools, and marking one resolved is `git_commit` after the edit.
- **No UI cards.** Results render as text, so a client that wants a diff or commit card needs a presenter this package does not yet register.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>
