# Agent Note: A task gets its own git worktree, not the shared tree

Status: implemented

English | [中文](2026-10-26-git-worktrees-per-task.zh.md)

## Problem

Two agents working on one repository share a working tree, which means they share a branch, a build directory, and whatever the other left uncommitted. A second agent that needs to change code either waits, or edits the same files, or produces a commit on the branch the first agent is preparing. Cloning avoids the contention and duplicates the object store and the setup.

The port target is DeepSeek Harness's Git Worktrees service and its `create_worktree` tool: their agent creates a worktree, then works in it. Aeven had no way to enter another directory at all until `session/cwd` landed, so the worktree half of that pair could not exist before the directory half did.

## Decision

`@aeven/worktrees` owns the operation. `create(session, { name?, from? })` resolves the repository root from the session's effective directory, resolves the base commit, runs `git worktree add -b <branchPrefix><name> <root>/<directory>/<name> <from>` through `ctx.subprocess`, and only then moves the session through `ctx.workingDirectory.change()`. `list()` parses `git worktree list --porcelain`.

The order is the contract: the directory change is the last step, so a failed checkout leaves the session where it was and the model can keep working. `@aeven/tool-worktrees` exposes the same operation as `create_worktree`, returning `{ path, branch, baseCommit, repositoryRoot }`.

Checkout directory, branch prefix, and the git grace period are `Config` with no defaults, because a deployment chooses where checkouts live and how branches are named; the base bundle states `.aeven/worktrees`, `avn/`, and 5000 ms.

The capability shells out to git instead of importing a library, because the checkout is git's construct: `worktree add`, `worktree list`, and `worktree remove` are the operations, and a wrapper would have to reproduce their arguments and error text for no gain.

## Alternatives considered

- **Clone per task.** Isolates completely, at the cost of a second object store, a second install, and a copy of every uncommitted file the new task does not need.
- **One shared tree with a branch per agent.** Keeps the object store shared but leaves the working tree shared too, so builds and uncommitted edits still collide.
- **Switch branches in place.** Cheap, and loses the other agent's uncommitted work the first time anything needs a clean tree.
- **A library such as `isomorphic-git`.** Adds a dependency that reimplements the three commands the capability needs, and its error text is not the error text users read from their own shell.

## Consequences

- A task that creates a worktree changes the directory every later call resolves against, and that change is logged as `session/cwd`, so a resumed or forked session continues in the checkout.
- A checkout under the repository root appears as untracked in `git status` unless the repository ignores it; the README states this and points a deployment that wants a clean source tree at a `directory` outside the repository.
- `list` has no tool and removal is not wrapped, so a finished checkout stays registered until someone runs `git worktree remove` or prunes.
- The specs run real git in a temporary repository rather than mocking it, because the behavior worth asserting is exactly what a mock cannot show: the branch, the directory, the untouched source tree, and git's own refusal of a duplicate name.
