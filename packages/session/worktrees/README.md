---
description: "Git worktrees as a session capability: one branch-backed checkout per task or subagent, outside the repository, with writes confined to it."
kind: "package-reference"
---

# @aeven/worktrees

English | [中文](README.zh.md)

## Summary

`@aeven/worktrees` gives a task its own checkout so agents on one repository do not edit, build, or switch branches in each other's working tree. `create()` adds a branch-backed checkout and moves the session into it; `isolate()` and `adopt()` give every delegated in-process subagent its own checkout from a snapshot of the parent's working tree; `remove()` deletes a checkout and optionally its branch. Checkouts live outside every repository, and the moved session's workspace root is the checkout, so `workspace-write` confines its writes there.

## Table of Contents

- [Contract](#contract)
- [Configuration](#configuration)
- [Dev Note](#dev-note)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

## Contract

Checkouts of a repository live at `<directory>/<repository name>-<8 hex of its shared git directory>/<name>`, and branches are `<branchPrefix><name>`. Names are letters, digits, dots, dashes, and underscores, starting with a letter or digit. The service's own git calls run with `core.hooksPath=/dev/null` and `core.fsmonitor=false`, so no repository-configured hook or monitor runs.

`create(session, { name?, from? }, signal?)` resolves `from` (default `HEAD`) to a commit, runs `git worktree add -b`, runs the setup entry described under [Configuration](#configuration), then moves the session with `workingDirectory.enter()` and appends `worktree/entered`. A generated `work-<8 hex>` name is used when none is given. Uncommitted changes in the current checkout do not carry over. A git failure surfaces with git's output and leaves the session where it was.

`isolate(parent, childId, signal?)` returns `undefined` when `isolateSubagents` is off or the parent's directory is not a git repository with a commit. Otherwise it records the parent's working tree — tracked changes and untracked, unignored files — as a commit on top of `HEAD`, through a copy of the index, so the user's index, files, and branch stay untouched; a clean tree uses `HEAD` itself. It creates `subagent-<8 hex>` from that commit, runs setup, appends `worktree/delegated` to the parent's log, and returns the checkout. `adopt(child, worktree)` moves the child in synchronously inside its creation window and appends `worktree/entered`. `@aeven/subagent` calls both for every in-process child, one-shot and continuable.

`remove(session, name?, { deleteBranch }, signal?)` removes the named checkout, or the one the session works in. A session inside it moves back to the repository's main working tree first. `git worktree remove` refuses a checkout with uncommitted changes, and `git branch -d` refuses an unmerged branch; both refusals surface as errors. Success appends `worktree/removed`.

`list(session, signal?)` parses `git worktree list --porcelain` into `{ path, ref, head, main, prunable }` entries, main working tree first.

The `worktrees` projection folds the three events into the checkout the session works in and the checkouts it created for children. Before each request it renders that state as runtime context: a session in its own checkout is told the checkout, branch, base commit, and setup outcome; a parent is told each child's branch, path, and base, and how to take the work (`git merge <branch>` on a clean tree, `git diff <base>..<branch> | git apply` beside uncommitted changes).

## Configuration

| Field | Meaning |
|---|---|
| `directory` | Absolute directory holding the checkouts; created and canonicalized at load. |
| `branchPrefix` | Prefix every created branch carries. |
| `graceMs` | Grace a git or setup child gets between SIGTERM and SIGKILL. |
| `isolateSubagents` | Whether every delegated in-process child works in its own checkout. |
| `setup` | Ordered `{ when, argv }` entries; the first whose `when` file exists at the checkout root runs `argv` there without a shell. |
| `setupTimeoutMs` | Deadline for the setup command. |

The base bundle sets `$AVN_HOME/worktrees`, `avn/`, `5000`, isolation on, a 300000 ms setup deadline, and one setup entry per lockfile: `pnpm install --frozen-lockfile --prefer-offline`, `yarn install --frozen-lockfile`, `bun install --frozen-lockfile`, and `npm ci --prefer-offline`.

## Dev Note

The capability runs git through `ctx.subprocess` rather than a git library, because the checkout is git's own construct and a wrapper would have to reproduce its argument and error semantics.

Checkouts live outside the repository because `@aeven/sandbox-policy` confines a session to its workspace root: with checkouts under the repository, an agent in the main tree could write every child's checkout. A linked checkout's commits land in the repository's shared git directory, so the sandbox policy grants that directory beside the checkout.

The snapshot commit is what lets a child review or continue the parent's uncommitted work. It sits between `HEAD` and the child's own commits, so `git diff <base>..<branch>` is exactly the child's work and applies cleanly beside the parent's uncommitted changes.

The specs use real git in a temporary repository, because the behavior worth testing is git's own: that a branch and a checkout are created, and that a duplicate name fails through git's error path.

## Model Experience

The model-facing verbs live in [`@aeven/tool-worktrees`](../tool-worktrees/README.md). This package adds runtime context.

### Worktree runtime context

#### What the model sees

A session in its own checkout: `You work in your own git worktree "<path>" on branch <branch>, started from commit <12 hex> of the repository at "<root>". Other agents work in other checkouts of the same repository. Commit your finished changes on this branch and name the branch when you report back.`, plus `Dependency setup in this worktree: <outcome>` when setup ran. A parent with children's checkouts: one line per checkout with branch, path, subagent id, and base, then how to merge or apply the work and that `remove_worktree` removes a checkout.

#### Token effect

About 60 tokens for a session in a checkout, and about 30 per child checkout plus 50 for the merge instructions.

#### KV Cache effect

Runtime context sits after the stable system prompt and is logged with each request, so it leaves the cached prefix intact; it changes only when a checkout is entered, created for a child, or removed.

## Known Limitations and Deferred Work

- **Setup runs unconfined.** The setup command needs the package manager's store outside the checkout, so it runs through `ctx.subprocess` without the sandbox. The command is deployment configuration; the scripts it runs come from the repository.
- **Out-of-process subagents are not isolated.** `subagent-avn-sdk`, `subagent-acp`, `subagent-claude-code`, and `subagent-codex` start their child in the parent's header directory.
- **Instructions and skills read the header directory.** Project instructions and skill discovery resolve against the session's creation directory, which matches the checkout only when the branch carries the same files.
- **Shared ports and caches.** Checkouts separate files and builds, not dev-server ports or caches outside the checkout.
- **A failed child start keeps its checkout.** The checkout and branch stay, and the parent's context lists them for `remove_worktree`.
- No invariant companion is published because its observable outcomes are git's exit status and the events it appends, which the specs assert directly.
