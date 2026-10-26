---
description: "Git worktrees as a session capability: create a branch-backed checkout through git, move the session into it, and list the checkouts a repository has."
kind: "package-reference"
---

# @aeven/worktrees

English | [中文](README.zh.md)

## Summary

`@aeven/worktrees` gives a task its own checkout. `create()` runs `git worktree add -b <prefix><name> <path> <rev>` and then moves the session into the new directory through `@aeven/working-directory`, so every later file, shell, and search call resolves against the checkout instead of the shared tree. `list()` reads the repository's registered checkouts. Use it when parallel agents would otherwise contend for one branch and one build directory, or when a change should be tried without touching what is already uncommitted in the main tree.

## Table of Contents

- [Contract](#contract)
- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Contract

`create(session, { name?, from? }, signal?)`:

1. Resolves the repository root from the session's effective directory (`git rev-parse --show-toplevel`).
2. Validates the name — letters, digits, dots, dashes, underscores, starting with a letter or digit — because the name is both the branch leaf and the directory leaf. A generated `work-<8 hex>` name is used when none is given.
3. Resolves the base commit (`rev-parse <from>`, default `HEAD`), then runs `git worktree add -b <branchPrefix><name> <root>/<directory>/<name> <from>`.
4. Moves the session with `workingDirectory.change()`, which appends `session/cwd`.
5. Returns `{ path, branch, baseCommit, repositoryRoot }`.

A duplicate name, a name git rejects, or a directory git cannot create surfaces as the git failure with its stderr, naming the command and the exit; the session's directory is left unchanged because the change happens only after `git worktree add` succeeds.

`list(session, signal?)` parses `git worktree list --porcelain` into `{ path, ref, head, main, prunable }` entries, main working tree first.

## Configuration

| Field | Meaning |
|---|---|
| `directory` | Directory under the repository root that holds checkouts. |
| `branchPrefix` | Prefix every created branch carries. |
| `graceMs` | Grace a git child gets between SIGTERM and SIGKILL. |

The base bundle sets `.aeven/worktrees`, `avn/`, and `5000`.

## Dev Note

The capability runs git through `ctx.subprocess` rather than importing a git library, because the checkout is git's own construct: `worktree add`, `worktree list`, and `worktree remove` are the operations, and a library wrapper would have to reproduce their argument and error semantics for no gain.

Order matters in `create`: resolve the base commit before the checkout, run the checkout before the directory change. A failure at any step leaves the session where it was, which is what makes "the checkout failed, keep working where you are" a safe answer for a model.

The specs use real git in a temporary repository, because the thing worth testing is exactly the part a mock cannot show: that a branch and a directory are created, that an uncommitted file in the source tree stays out of the new checkout, and that a duplicate name fails through git's own error path.

## Model Experience

### `create_worktree` tool schema

#### What the model sees

The model sees the generated [`create_worktree` schema](../../../docs/tool-catalog.md#aeventool-worktrees): an object with optional `name` and `from` strings. The description says a worktree gives a task its own checkout — parallel work on one repository, trying a change without touching the main tree — and that later calls resolve against the new directory.

#### Token effect

Fixed schema cost on every request where the tool is visible.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool call and result

#### What the model sees

Success returns `{ path, branch, baseCommit, repositoryRoot }` and one rendered line: `Created worktree <path> on branch <branch> (from <short sha>). This session now works there; later calls resolve relative paths against it.` Failures are the git command, its exit, and its stderr, or `create_worktree requires an owning agent session`.

#### Token effect

One result per call: two paths, a branch, and a commit prefix. The checkout itself costs no tokens; the model learns the new directory from this result and from the resolved paths of its later calls.

#### KV Cache effect

Append-only; the result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- **`list` has no tool.** The capability lists checkouts, but no model-facing verb exposes it yet; a model that needs to know its siblings asks the shell.
- **Removal is manual.** `git worktree remove` is not wrapped, so a finished checkout stays registered until someone removes it or the directory is pruned.
- **A checkout inside the repository shows up as untracked.** The configured `directory` defaults to a path under the repository root, so a repository that does not ignore it reports `.aeven/` in `git status`. A deployment that wants a clean source tree points `directory` outside the repository.
- This package publishes no `./invariant` companion: its observable outcome is the git exit status plus the `session/cwd` it appends, which the specs assert directly, and a companion could only restate them.
