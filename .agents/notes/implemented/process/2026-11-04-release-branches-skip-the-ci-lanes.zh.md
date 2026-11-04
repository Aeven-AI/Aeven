# Agent Note: 发布分支的 Pull Request 跳过 CI lane

Status: implemented

[English](2026-11-04-release-branches-skip-the-ci-lanes.md) | 中文

## 问题

一次 avn 发布落成一个提交：它重写每个 workspace manifest 中的一个版本字段并更新 lockfile。四条 pull-request lane 的存在是为了告知行为变更；版本递增不含行为变更，但每个发布 pull request 仍要在其上花掉完整矩阵，并且只因为 owner 手工打了 `skip-ci` 标签才得以合并。一次遗漏就会耗尽 lane 预算，并让发布卡住直到有人发现。

## 决策

[`.github/workflows/ci.yml`](../../../../.github/workflows/ci.yml) 中的每个 job 跳过 head 分支以 `release/` 开头的 pull request。发布流程保持该前缀，因此发布提交的 pull request 不启动任何 lane，也不需要标签。`skip-ci` 仍用于 lane 无法告知的其他变更，例如 workflow 策略。

条件读取 `github.head_ref`，它在 `merge_group` 与 `workflow_dispatch` 上为空，因此排队批次仍会重新检查合并结果，手动 dispatch 也仍会运行 lane。

## 考虑过的替代方案

**手工给每个发布 pull request 打 `skip-ci` 标签。** 这正是发布流程原先的做法；它依赖 owner 记得，且发布等的是一个标签，而不是它 diff 的任何事实。

**匹配发布提交的标题。** 标题模式只活在提交文案里，一次改名就会静默地重新启动 lane。

**发布时照常运行 lane。** 矩阵于是为每次发布花掉完整时长，只为告知一个版本字段的 diff，而那次发布的树已由上一版证明过。

## 后果

如果发布分支带了版本递增之外的内容，它的 pull request 仍会未经验证，因为决定因素是分支名而不是 diff。审查发布分支改了什么仍是 owner 的任务。
