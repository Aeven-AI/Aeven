# Agent Note: A default-branch commit is refused locally

Status: implemented

English | [中文](2026-10-15-default-branch-commits-are-refused-locally.zh.md)

## Problem

`main` accepted direct commits and direct pushes. An agent working in a checkout that sits on `main` therefore committed there by habit, and the mistake was only visible afterwards, as a branch that no longer matched `origin/main` and a change that never had a pull request to review, label, or link to an issue.

## Decision

- **A `pre-commit` job refuses a commit while the default branch is checked out.** `scripts/verify-not-default-branch.sh commit` reads `git symbolic-ref --short HEAD` and exits non-zero on `main` or `master`, naming the branch to switch to. A detached HEAD is allowed, since it cannot name the default branch and the push is guarded separately.
- **A `pre-push` job refuses a push whose remote ref is the default branch.** The same script in `push` mode reads git's pre-push lines from stdin and fails on `refs/heads/main` or `refs/heads/master`, so a change reaches the branch only through a pull request.
- **GitHub refuses both server-side too.** The `main` ruleset requires a pull request, forbids deletion, and forbids force pushes, with no bypass actor — a direct push fails even with the hooks uninstalled.

## Alternatives considered

**The ruleset alone.** It stops every direct push, which is the outcome that matters, but a commit made on `main` locally still has to be moved off it by hand, and the failure arrives at push time, after the work is already on the wrong branch.

**A `commit-msg` or `post-commit` warning.** A warning leaves the commit in place and depends on the agent reading it; both hooks here fail closed instead.

**Refusing commits whenever `HEAD` is not a branch.** Detached-HEAD work in a worktree is a normal way to inspect a tag or a release commit, and the push guard already covers the case that matters.

## Consequences

- Every change reaches `main` through a pull request: branch, commit, push, merge, then fast-forward the local branch.
- A checkout that sits on `main` with work in progress cannot commit until the work is moved to a branch; `git switch -c <name>` keeps the changes and clears the refusal.
- The guards live in the local checkout, so a clone without `scripts/install-lefthook.mjs` has only the server-side ruleset.
