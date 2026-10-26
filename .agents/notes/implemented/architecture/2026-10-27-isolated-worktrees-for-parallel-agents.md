# Agent Note: Parallel agents work in isolated worktrees outside the repository

Status: implemented

English | [中文](2026-10-27-isolated-worktrees-for-parallel-agents.zh.md)

## Problem

[A task gets its own git worktree](2026-10-26-git-worktrees-per-task.md) gave a session a way to create a checkout, but agents still worked against each other. File, search, and LSP tools resolved relative paths against the session header, so after `create_worktree` an agent's edits landed in the main checkout. `tool-bash` preferred the sandbox root, which came from the header, so plain commands ran there too. Checkouts lived under the repository, inside every session's `workspace-write` root, so any agent could write any checkout. Isolation depended on the model choosing to call `create_worktree`, and subagents never did.

## Decision

The session has two logged facts: the working directory and the workspace root. `session/cwd` gains an optional `root`; `@aeven/working-directory` exposes `of()` and `rootOf()`, and every consumer that resolves a path or a write boundary reads them: shell, file, search, LSP, `bash-edit-guard`, the terminal panel, `@`-file references, the workspace file browser, and `@aeven/sandbox-policy`. Changing into a subdirectory moves only the directory; entering a worktree moves both.

Checkouts live under `$AVN_HOME/worktrees/<repository>-<digest>/<name>`, outside every repository, so a session confined to one checkout cannot write another. A linked checkout's commits land in the repository's shared git directory, so `sandbox-policy` adds that directory as `additionalWritableRoots`, which Seatbelt, bwrap, Landlock, the Windows ACL grant, and the in-process filesystem fence all honor.

Every delegated in-process subagent gets its own checkout. `@aeven/subagent` calls `ctx.worktrees.isolate()` before creating the child and `adopt()` inside its creation window, following the same optional `ctx.get` pattern as the delegated sandbox policy. The checkout starts from a snapshot commit of the parent's working tree, built through a copy of the index so the user's index, files, and branch stay untouched, because a child asked to review or continue the parent's work must see its uncommitted changes. A child without a checkout inherits the parent's logged directory. The parent's log records `worktree/delegated` and the child's records `worktree/entered`; runtime context tells each agent its checkout and tells the parent how to merge or apply each child's branch. `remove_worktree` removes a finished checkout.

A new checkout runs the first configured setup entry whose lockfile it contains, because a checkout without dependencies cannot build. The service's git calls disable repository hooks and fsmonitor, following DeepSeek Harness's worktree service.

## Alternatives considered

- **Keep checkouts under the repository.** DeepSeek Harness does this with the sandbox root left at the header. It separates branches but not writes: an agent in the main tree can still edit every checkout.
- **Model-chosen isolation only.** Leaves two agents sharing a tree whenever either forgets to call the tool, which is the failure this note exists to remove.
- **Start a child from `HEAD`.** Simpler, and a child reviewing or extending the parent's uncommitted work would see none of it.
- **Run setup inside the sandbox.** Package managers write a store outside the checkout, so a confined install fails; setup runs unconfined as deployment-chosen configuration.

## Consequences

- An agent's relative paths, plain shell commands, and sandboxed writes all follow its checkout, and a persistent shell restarts in the new directory on its next command.
- Starting a subagent in a git repository costs a snapshot, a `git worktree add`, and a dependency install.
- A parent takes a child's work with `git merge <branch>` on a clean tree or `git diff <base>..<branch> | git apply` beside uncommitted changes; the snapshot commit makes that diff exactly the child's work.
- Out-of-process subagent providers, project instructions, and skill discovery still read the header directory.
- Checkouts separate files and builds, not dev-server ports or caches outside the checkout.
