---
description: "The model-facing create_worktree tool over the git worktree session capability: create a branch-backed checkout from a chosen revision and move the session into it, with the model-facing description and result text."
kind: "package-reference"
---

# @aeven/tool-worktrees

English | [中文](README.zh.md)

The `create_worktree` model tool over `@aeven/worktrees`.

## Summary

`avn-tool-worktrees` lets an agent put a task in its own git checkout. One call creates a branch-backed worktree from `HEAD` or from a revision the model names, and moves the session there, so parallel agents stop sharing one working tree and one branch. Work that needs somewhere to build, retry, or diverge stops copying directories by hand. Use it wherever an agent works on a repository in parallel with another agent, tries a change in isolation, or leaves a build in place while starting something else.

## Table of Contents

- [Contract](#contract)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

## Contract

- `create_worktree({})` creates a checkout named `work-<8 hex>` from the session repository's `HEAD`, moves the session into it, and reports `{ path, branch, baseCommit, repositoryRoot }`.
- `create_worktree({ name })` uses the name for both the checkout directory and the branch suffix; `create_worktree({ from })` starts the branch from a branch, tag, or commit instead of `HEAD`.
- The tool needs an owning agent session; a caller without one is rejected, because the checkout is created for, and the directory change is logged against, that session.

Rendering names the consequence in one line — `This session now works there; later calls resolve relative paths against it` — so the model does not have to infer what a checkout means for its next call.

## Dev Note

The tool is thin on purpose. Name validation, the git calls, and the directory change all live in `@aeven/worktrees`, so the tool's spec mounts the real service over a scratch repository and asserts what git registered and what the session log recorded; a tool that ran `git worktree add` itself would duplicate the service and drift from the directory the shell tools resolve.

## Model Experience

### Tool schema

#### What the model sees

The model sees the generated [`create_worktree` schema](../../../docs/tool-catalog.md#aeventool-worktrees): an object with two optional strings, `name` and `from`. The description states that the checkout is created from `HEAD` or from the named revision and that every later file, shell, and search call resolves against it, so the model does not re-resolve paths in each call.

#### Token effect

Fixed schema cost on every request where the tool is visible; the description and schema are stable for a given configuration.

#### KV Cache effect

Prefix-stable while the definition and visibility are unchanged. Plugin lifecycle or scoped restrictions may invalidate reuse from this schema.

### Tool calls and results

#### What the model sees

A successful call returns the absolute path, the branch, the base commit, and the repository root, and renders one line naming the branch, the first twelve characters of the base commit, and the consequence for later calls. Stable failures are `Error: create_worktree requires an owning agent session` and the service's messages naming the unusable worktree name or the failing git command.

#### Token effect

Small and fixed-shape: three short identifiers, one boolean-free object, one sentence. The checkout is not re-sent; a later call that resolves a relative path already carries the directory.

#### KV Cache effect

Append-only; the result follows the reusable request prefix and does not invalidate existing KV-cache entries.

## Known Limitations and Deferred Work

- The tool creates checkouts only; a model cannot list or remove one, so a task that finishes leaves its checkout for the operator.
- The model cannot choose the checkout directory or the branch prefix; both are deployment configuration on `@aeven/worktrees`.
- No invariant companion is published because the only relationship it could check is the service's own git and log effects, which the unit spec observes directly, and no independent observation can diverge.
