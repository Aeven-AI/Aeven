# Agent Note: Subagent 树的共享任务板

Status: implemented

[English](2026-11-04-shared-task-board.md) | 中文

## 问题

同一 subagent 树中的智能体现在可以互相发现并发送消息，但没有任何地方记录谁负责哪部分工作、哪些必须先完成，或两个智能体是否即将修改相同文件。根智能体必须在自己的上下文中分配并跟踪每一项。实验性 Agent Teams 包在 subagent 运行时之外保留了第二套 roster、mailbox 与控制工具，声明了发布包无法共享的 `team/task` 事件，并且由于发布包不得依赖实验包而无法发布。

## 决策

`@aeven/agent-team` 与 `@aeven/tool-agent-team` 位于新的 `packages/team/` 发布组，取代五个实验性 Agent Teams 包。服务沿用上游 deepseek-harness 的当前设计：每个根 Agent 及其后代共享一个任务板，以整任务 `team/task` 事件存储在根 Session 中，成员关系来自 `ctx.subagents.rootOf()` 而非 roster。认领、释放、编辑、依赖变更、完成、重新打开、重新分配与删除都基于 `revision` 做 compare-and-set；只有负责人或根可以修改任务，只有根可以重新分配。

任务板始终可用。没有 Team 模式、没有 `team/mode` 事件，也没有系统提示词段落；四个 `team_task_*` 工具在描述中携带工作流指引，aeven preset 将它们与 `list_agents`、`send_message` 一起延迟到 `tool_search` 之后。base bundle 挂载这两个包。不增加客户端视图或 UI；`agentTeam` projection 仅在宿主侧。

已发布数据中不存在历史 Team 记录，因此格式从 `team/task` 版本 1 开始，不解码 roster 或 mailbox 记录。[实验性 Agent Teams 包](../architecture/2026-08-18-experimental-agent-teams-packages.zh.md)、[Agent Teams](2026-08-05-agent-teams.zh.md)、[Agent Teams Web](2026-08-06-agent-teams-web.zh.md) 与[精简 Agent Teams 表面](../simplification/2026-08-12-trim-agent-teams-read-and-lifecycle-surface.zh.md)的决策均被取代。

## 备选方案

移植上游 Team 模式会保留按会话的开关与菜单项；需求明确排除了两者，而延迟工具已经让未使用的 schema 不进入请求。保留实验包会维持第二套身份系统并阻止发布使用。在运行时上下文中常驻任务板视图会让每棵树的每一步都消耗提示词 token。

## 影响

任务变更从不唤醒或通知智能体；智能体通过读取任务板或接收 `send_message` 获知。负责人停止时所有权不会自动释放。写入范围保持建议性，真正的隔离由每个子级的 worktree 提供。协调仅在单进程内，与 subagent 容量池相同。

## 验证

聚焦测试覆盖顺序 id、就绪状态、树范围共享与根隔离、compare-and-set 拒绝、负责人与根的权限、仅限成员的重新分配、写入范围警告、依赖图规则、任务上限、串行化的并发命令、未确认的持久化、回放失败与 fork 隔离。工具测试覆盖注册与销毁、子智能体的认领流程、列表过滤与分页，以及拒绝情况。
