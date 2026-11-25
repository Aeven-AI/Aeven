# Agent Note：同步会话的待办列表未在其他设备上显示

Status: implemented

[English](2026-11-25-synced-sessions-project-todos-and-plan.md) | 中文

## 问题

2026-11-25，一个桌面端对话（`session-45df5e4a…`）三次写入待办列表，桌面端 dock 正常显示。同一对话在 chat.aeven.io 打开时完全没有 dock。Aeven Web 持有该对话的同步副本：事件经会话同步和 `session-persistence/append` 到达，那里没有 agent 运行它。两个缺陷让投影状态无法到达浏览器。

- `session-handoff/imported` 重建携带全部投影值的列表摘要，却在发出 `api-session/added` 时不带会话所有者。转发事件的受众从 live Session 或先前带所有者的 `api-session/added` 解析所有者；Host 重启后同步副本两者都没有，而强制区分账户的 Host 不会把所有者未知的事件投递给任何人。在别处运行的对话，其待办列表、目标、计划与标题的每次更新都被丢弃。
- 投影表是进程级的，而 `todos` 与 `plan` 只由 agent 预设中的 `tool-todo` 与 `plan-mode` 行注册。跟随同步副本的 Host 没有它的 agent，因此这些键只在恰好有其他 agent 挂载时存在，否则开场快照和每次重建的摘要都会缺少它们。目标在投递修复后即可到达其他设备，因为 `goal` 留在 Host 平面。

## 决定

- 导入处理器发出 `api-session/added` 时附带导入所指明的所有者。
- `@aeven/tool-todo/projection` 与 `@aeven/plan-mode/projection` 单独注册 `todos` 与 `plan` 单元，Web bundle 把两者挂在 Host 平面。预设行仍注册相同定义；同一键的多次注册共享一个引用计数的单元。
- 审批与提问已经通过会话控制器的交互中继到达每台设备，保持不变。

## 考虑过的替代方案

- **把 `tool-todo` 与 `plan-mode` 挂在 Host 平面。** 否决：两者都注册面向模型的工具、提示段落和步骤监听器，这些属于挂载其预设的 agent。
- **为导入事件从 follow 流推送投影帧。** 否决：导入处理器已经为列表摘要折叠整张投影表，客户端按同样的高 seq 优先规则应用摘要投影，第二条路径会重复它。

## 影响

Host 平面插件注册的每个客户端可见投影，现在都会随每个同步批次落地而跟随对话到达账户的其他设备。只由预设注册的投影，仍只在跟随它的 Host 上挂载了该预设时才到达其他设备，同样的 Host 平面拆分适用于它。待办列表的内容仍取决于模型调用 `todo_write`；上述对话在两次过期提醒后仍有 27 次工具调用没有写入。
