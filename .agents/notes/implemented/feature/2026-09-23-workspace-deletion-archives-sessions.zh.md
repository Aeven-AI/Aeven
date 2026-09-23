# Agent Note：删除工作区会归档其会话

Status: implemented

[English](2026-09-23-workspace-deletion-archives-sessions.md) | 中文

## 问题

删除 Workspace 后，其 Session 会留在 Ungrouped 下。删除项目的用户希望这些 Session 从侧边栏消失，而 Ungrouped 把它们放进一个没有名称、没有归属的分组。

## 决策

`WorkspaceRegistry.delete(id)` 在把该 id 移出 `workspaceIds` 并记录待删除标记的同一次注册表状态写入中，把被删除 Workspace 的成员 Session 追加到 `archivedSessionIds`。已归档的 id 保持原位置。表写入回滚会把归档集合与原顺序一并恢复，启动恢复则保留标记写入已提交的归档集合。Host feed 在 `remove` 之前发布现有的 `archived` 增量，因此客户端无需新帧。文件夹、文件与 Session 日志仍然一概不动（[注册删除](2026-07-27-workspace-registration-deletion.zh.md)）。

## 考虑过的替代方案

**把 Session 移入内置的 Chats Workspace。** 已否决：Chats 没有目录，会拒绝 header 记录了 cwd 的 Session；而从 Chats 恢复的 Session 仍会在被删除项目的文件夹中运行。
