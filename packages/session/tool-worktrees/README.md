---
description: "The model-facing create_worktree and remove_worktree tools over the git worktree session capability: create a branch-backed checkout and move the session into it, or remove a finished one."
kind: "package-reference"
---

# @aeven/tool-worktrees

English | [中文](README.zh.md)

The `create_worktree` and `remove_worktree` model tools over `@aeven/worktrees`.

## Summary

`@aeven/tool-worktrees` lets an agent put a task in its own git checkout and clean it up afterwards. `create_worktree` creates a branch-backed checkout from `HEAD` or from a revision the model names and moves the session there, so parallel agents stop sharing one working tree and one branch; `remove_worktree` removes a checkout once its branch is merged or abandoned. Subagents get their own checkout without a call. Use it wherever an agent works on a repository in parallel with another agent, tries a change in isolation, or leaves a build in place while starting something else.

## Table of Contents

- [Contract](#contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Contract

- `create_worktree({})` creates a checkout named `work-<8 hex>` from the session repository's `HEAD`, moves the session into it, and reports `{ path, branch, baseCommit, repositoryRoot }` plus `setup` when a dependency setup command ran.
- `create_worktree({ name })` uses the name for both the checkout directory and the branch suffix; `create_worktree({ from })` starts the branch from a branch, tag, or commit instead of `HEAD`.
- `remove_worktree({})` removes the checkout the session works in and moves the session back to the repository's main checkout; `remove_worktree({ name })` removes the named checkout, such as a subagent's. `delete_branch: true` also deletes the branch. It reports `{ path, branchDeleted }` plus `branch` and `cwd` when known.
- Both tools need an owning agent session; a caller without one is rejected, because the checkout is created for, and the directory change is logged against, that session.

Rendering names the consequence in one line — `This session now works there; later calls resolve relative paths against it` — so the model does not have to infer what a checkout means for its next call.

## Dev Note

The tools are thin on purpose. Name validation, the git calls, setup, and the directory change all live in `@aeven/worktrees`, so the tool's spec mounts the real service over a scratch repository and asserts what git registered and what the session log recorded; a tool that ran `git worktree add` itself would duplicate the service and drift from the directory the other tools resolve.

## Model Experience

### Tool schemas

#### What the model sees

The model sees the generated [`create_worktree` and `remove_worktree` schemas](../../../docs/tool-catalog.md#aeventool-worktrees). `create_worktree` takes two optional strings, `name` and `from`; its description states that the checkout is created from `HEAD` or the named revision without uncommitted changes, that later calls resolve against it and writes are confined to it, and that subagents already get their own worktree. `remove_worktree` takes an optional `name` and an optional `delete_branch` boolean; its description states the default target, the return to the main checkout, and git's refusals.

#### Token effect

Fixed schema cost on every request where the tools are visible; the descriptions and schemas are stable for a given configuration.

#### KV Cache effect

Prefix-stable while the definitions and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from these schemas.

### Tool calls and results

#### What the model sees

`create_worktree` renders one line naming the path, the branch, the first twelve characters of the base commit, and the consequence for later calls, plus `Dependency setup: <outcome>` when setup ran. `remove_worktree` renders `Removed worktree <path>` with whether the branch was deleted or kept and where the session works now. Stable failures are `Error: <tool> requires an owning agent session` and the service's messages naming the unusable worktree name, the worktree that is not removable, or the failing git command with git's output.

#### Token effect

Small and fixed-shape: a few short identifiers and one or two sentences. A setup failure adds at most 1500 characters of the command's output.

#### KV Cache effect

Append-only; the result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- A model cannot list checkouts through a tool; the runtime context names the session's own checkout and its children's, and the shell lists the rest.
- The model cannot choose the checkout directory or the branch prefix; both are deployment configuration on `@aeven/worktrees`.
- No invariant companion is published because the only relationship it could check is the service's own git and log effects, which the unit spec observes directly, and no independent observation can diverge.
