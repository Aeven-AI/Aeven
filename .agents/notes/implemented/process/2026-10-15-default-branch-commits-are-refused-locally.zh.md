# Agent Note: 在默认分支上的提交会被本地拒绝

Status: implemented

[English](2026-10-15-default-branch-commits-are-refused-locally.md) | 中文

## 问题

`main` 接受直接提交与直接推送。因此，在一个停在 `main` 上的检出中工作的 agent 会顺手提交到那里，而错误只能在事后才被发现：分支与 `origin/main` 不再一致，而且这个改动从未有过可供评审、打标签、关联 issue 的 pull request。

## 决定

- **`pre-commit` 作业在默认分支被检出时拒绝提交。** `scripts/verify-not-default-branch.sh commit` 读取 `git symbolic-ref --short HEAD`，在 `main` 或 `master` 上以非零退出，并指出应切换到的分支。分离头指针（detached HEAD）被允许，因为它无法指名默认分支，而推送另有守卫。
- **`pre-push` 作业拒绝远端引用为默认分支的推送。** 同一个脚本以 `push` 模式从 stdin 读取 git 的 pre-push 行，在 `refs/heads/main` 或 `refs/heads/master` 上失败，因此改动只能经 pull request 到达该分支。
- **GitHub 在服务端同样拒绝。** `main` ruleset 要求 pull request、禁止删除、禁止强推，且没有豁免主体——即使钩子未安装，直接推送也会失败。

## 考虑过的替代方案

**只用 ruleset。** 它能阻止所有直接推送，而这正是关键结果；但本地在 `main` 上做出的提交仍需手工搬离该分支，且失败要到推送时才出现——那时工作已经在错误的分支上了。

**`commit-msg` 或 `post-commit` 警告。** 警告会留下这个提交，并且依赖 agent 去阅读它；这里的两个钩子都改为失败即拒绝。

**只要 `HEAD` 不是分支就拒绝提交。** 在 worktree 中以分离头指针工作是查看某个 tag 或发布提交的正常方式，而推送守卫已经覆盖了真正要紧的情形。

## 后果

- 每个改动都经 pull request 到达 `main`：建分支、提交、推送、合并，然后在本地快进该分支。
- 停在 `main` 且带有进行中工作的检出，在把工作移到分支之前无法提交；`git switch -c <name>` 会保留改动并解除拒绝。
- 守卫位于本地检出中，因此未运行 `scripts/install-lefthook.mjs` 的克隆只有服务端的 ruleset。
