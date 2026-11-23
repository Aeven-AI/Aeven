# Agent Note: Bot runs report their outcome, calendar events and jitter wake bots, and handoffs join per chain

Status: implemented

[English](2026-11-23-bot-run-outcomes-calendar-joins.md) | 中文

## Problem

[触发器列表与交接](2026-11-20-bot-triggers-connectors-boards.zh.md)之后还留有三处缺口。轮次完成的执行总是记为 `succeeded` 并替换 Bot 的上次结果，因此轮询型 Bot 整天报告“没有新内容”，而无法完成任务的执行看起来也像已完成（[#752](https://github.com/Aeven-AI/Aeven/issues/752)）。排程无法表达“每次会议前 15 分钟”或“7 点左右”，所有账户的所有 Bot 都在同一分钟触发（[#753](https://github.com/Aeven-AI/Aeven/issues/753)）。交接只能从一个 Bot 到一个 Bot，因此无法构建“研究员和分析师都完成后编辑再写”，失败的一步也不会让后续步骤跳过（[#754](https://github.com/Aeven-AI/Aeven/issues/754)）。

## Decision

### 执行结果

- 每个执行对话都从 `registerRunTools` 获得 `bot_no_update`、`bot_report_failure`（`reason`）和 `bot_pause`；根对话永远不会获得。调用只在内存中的 `ActiveRun` 上设置字段，`execute` 在执行结算时读取一次。
- 调用 `bot_report_failure` 后完成的轮次以该原因作为 `error` 结算为 `failed`；执行承担的交接随之失败，`wait` 回复携带该原因。
- `bot_no_update` 让结果为 `succeeded` 的执行成为 `quiet: true`，除非日志中有 `allowed-once` 以外的 `approval/decided`，或有一次成功的 `tool/call`，其 `presentCall` 为 diff 卡片或类型为 `edit`、`delete`、`move` 的通用卡片。`list` 把 `lastRun` 设为最近一次非安静的执行，`/bots` 把同一 Bot 连续两次及以上的安静执行折叠为一行。
- `bot_pause` 只在执行结算为 `succeeded` 时暂停 Bot，并在定义上保存 `pausedBy: { runId, scheduledFor }`。所有者自己的暂停或恢复会清除它。暂停只收窄 Bot 的行为，因此 `automation_*` 守卫保持不变。

### 日历触发器与抖动

- `{ kind: 'calendar', calendar?, filter, offsetMinutes }` 在每个匹配的定时活动开始后 `offsetMinutes` 分钟触发。`filter` 包含 `title`、`attendee`、`hasExternalAttendee` 和 `accepted`。参与者的域名不同于该活动上所有者自己地址的每个域名时即为外部参与者。
- 自动化包拥有 `CalendarSource` 服务定义和 `registerCalendarSource`。账户集成是提供方：它用每个连接器自己的令牌通过 REST 读取 Google Calendar 主日历和 Microsoft Graph 的 `calendarView`，不经过 MCP 进程或模型轮次。依赖方向与 `connectorBinding` 一致：账户集成本就依赖自动化包。
- 可运行该 Bot 的 Host 每隔 `calendarPollSeconds`（默认 300）读取一次，保存日历触发器后以及来源注册后也会读取。一次读取覆盖从当前时间之前的补执行宽限到之后两个读取间隔内的触发；调度器定时器在各自时刻触发。
- 日历触发以 Bot、触发器索引和不含开始时间的活动 ID 为标识。因此尚未触发的活动被移动后会在新时间触发，已触发后再移动不会触发第二次。这有意偏离 #753 的“活动 ID 加开始时间”标识，后者会让移动过的活动准入两次。
- 除 `once` 外的每种排程都可设置 `jitterMinutes`（1–30），把每次触发延后 `sha256(botId, 名义时刻) mod jitterMinutes` 整分钟。`nextFiring` 和 `latestDueFiring` 在该时刻附近最多扫描 64 个名义触发，抖动后的时刻同时是执行的 `scheduledFor`、触发标识和水位。间隔排程的抖动必须小于其间隔。

### 汇合与链

- `bot` 触发器为 `{ from: AutomationId[], join: 'all' | 'any', mode, joinTimeoutMinutes }`。已保存的单个 `from` 仍可读取，视为单元素列表，`join: all`、60 分钟。
- 每个交接和执行引用都携带 `chain`，即启动它的执行：没有被交接任务的执行自成一条链，回复继承所在的链。
- 多发送方边上的交接按接收方、边和链分组，不再逐个准入。`admitJoins` 对 `any` 在第一个未处理输入到达时准入，对 `all` 在每个发送方都有输入后准入。链中某次执行结算时没有把任务交给它所供给的汇合接收方，`settleRun` 会记录一个附原因的 `failed` 输入。超过 `joinTimeoutMinutes` 仍缺少的发送方成为超时输入。
- 汇合执行的 ID 由接收方、边和链哈希得到。它携带 `join.inputs`，其通知列出每个输入和每个失败。没有任何带任务输入的分组准入为一次跳过执行。
- `stopRun` 以 `CHAIN_STOPPED` 拒绝该执行所在链的每个未处理交接，并停止本 Host 所知的该链其他执行。`handOff` 和 `admitJoins` 把带有此类交接的链视为已停止。开始前被停止的排队执行现在也会结算其交接。
- 看板卡片按从早到晚列出其最近一条链的交接。

## Alternatives considered

- **为安静执行提供按 Bot 的“只在有新内容时通知”设置**：如 #752 所述被否决；由模型逐次决定，也能覆盖只是偶尔有内容的 Bot。
- **在调用 `bot_pause` 时立即暂停**：被否决，因为之后报告失败的执行必须让 Bot 保持启用，而撤销暂停会发布一个从未生效的定义修订。
- **通过连接器的 MCP 工具读取日历**：被否决。它需要智能体上下文，且每次读取都要启动 Workspace 或 Graph 的 MCP 进程；而用账户集成已在刷新的令牌做一次 REST 列表只需一个 HTTP 请求。
- **在账户集成上公开一个供自动化调用的活动列表方法**：被否决，因为自动化包无法依赖账户集成而不形成循环；注册方式把接口留在消费方。
- **在触发时随机抖动**：被否决；同一账户的两台 Host 会准入不同时刻，共享水位无法去重。
- **居中抖动（±）**：被否决，改用只延后的 `[0, jitter)`，执行永远不会早于所有者指定的时间开始。
- **单独的汇合记录类型**：被否决；失败输入就是普通的 `Handoff` 记录，因此汇合能跨重启保留，并通过现有交接条目同步到每台 Host。

## Consequences

- 产品中没有未读标记，因此 #752 的“不计为未读”没有可改之处；安静执行仍会让侧栏中的 Automations 工作区更新。
- 安静判定只能看到工具以文件变更形式呈现的修改；由 shell 命令写入的文件不会阻止安静。
- 有日历 Bot 启用时，每个读取间隔对每个已连接日历进行一次列表请求；在触发前不到一个读取间隔被删除的活动仍会触发。
- 日历去重与邮件一样以 Host 为单位。
- 高频 cron 配合较长抖动时，抖动后早于前一次触发的触发可能被跳过。
- 在接收方所在链之外运行的发送方永远不会汇入该链：其输入会等到 `joinTimeoutMinutes`，之后接收方带着标为超时的缺失发送方运行。
- 停止一条链会停止本 Host 准入的执行和它请求的云端执行；其他桌面准入的执行只会看到被拒绝的交接。
