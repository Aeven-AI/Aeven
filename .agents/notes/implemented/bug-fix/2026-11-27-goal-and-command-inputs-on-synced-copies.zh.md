# Agent Note：同步副本上的目标与命令输入

Status: implemented

[English](2026-11-27-goal-and-command-inputs-on-synced-copies.md) | 中文

## 问题

2026-11-27 在 chat.aeven.io 上清除目标时失败，返回 `session/agent-busy`：“session … is replicated from another device; fork it to continue”。该对话在用户的桌面设备上运行，因此托管 Host 只持有它的只读同步副本。`goals.clear` 等目标 Remote 方法以及 `commands.execute` 都接受 `Agent` 参数，Typert 的 `agent` 查找通过恢复 Session 来解析它；恢复同步副本会抛出 `SessionPersistenceReadOnlyError`。prompt、编辑、重试、队列变更、取消、模型选择和重命名不会失败，因为 Session Controller 在解析 Agent 之前会先认领该 Session，或把输入转发给写入它的设备。任务列表不受影响：只有模型会在 prompt 开启的回合中修改它。

## 决策

Session Controller 新增两个经路由的输入 `session.goal` 与 `session.command`，它们是客户端变更目标和执行斜杠命令行的唯一入口。暂停、完成和清除目标走模型选择的变更路线：认领该 Session 并在本设备写入，或转发给正在运行其回合的设备。创建、编辑和恢复目标以及执行命令行可能开启回合，因此走 prompt 的路线：优先发往该 Session 的归属设备，否则在本地认领。每次本地应用都以 `endChange` 结束，它在没有回合运行时交还运行租约；此后开始的目标轮次会在 `agent/pre-step` 中再次认领该 Session。接收方的 Session Controller 通过其转发输入分支中的 `goal` 与 `command` 两项应用转发来的输入。`GoalService` 不再有 Remote 方法，`commands.execute` 也不再是 Remote 方法，因此没有任何客户端路径会在未经路由的情况下为这些输入解析 Agent。

## 考虑过的替代方案

**在 Typert 的 `agent` 查找中认领**被否决：查找只收到 Session id，因此 `@` 文件选择器这类读取也会认领另一台设备正在运行的 Session，而以这种方式启用的目标轮次会在托管 Host 上运行，而不是在桌面设备上。**用 Typert 方法元数据标记写入型 endpoint** 需要为一条路由规则修改生成器和注册表。**在路由动词之外保留旧的目标 Remote 方法**会留下第二条在同步副本上失败的路径。

## 后果

转发的命令不向客户端报告执行结果；由其记录的 `command/run` 与 `command/done` 事件呈现结果。运行不含 `goal` 与 `command` 分支版本的桌面设备会拒收转发的输入，始终在线设备在输入回退时间后应用它。agent preset 切换、浏览器打开操作、Cordis 面板操作以及 `@` 文件和会话选择器仍通过查找解析 Agent，在同步副本上会失败；本次未改动它们。
