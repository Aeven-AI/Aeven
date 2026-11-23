# Agent Note：Bot 获得触发器列表、绑定的连接器、会过期的批准，以及带交接的看板

Status: implemented

[English](2026-11-20-bot-triggers-connectors-boards.md) | 中文

## 问题

Bot 定义只有一个计划和一个可选的入站 webhook，每次执行都挂载所有者的全部连接器，在执行对话中给出一次的批准永久有效且无法撤销（[#740](https://github.com/Aeven-AI/Aeven/issues/740)）。需要回应提及的 Bot 只能轮询：每次轮询都是一次完整的模型执行，要为每个连接器的工具目录付费，却发现没有新内容。权限不同的两个 Bot 无法互相传递工作，也没有任何记录说明谁唤醒了谁、一组 Bot 花了多少（[#741](https://github.com/Aeven-AI/Aeven/issues/741)）。

## 决策

- `AutomationDefinition.triggers` 取代 `schedule`。触发器是 `schedule`、`webhook`（最多一个，带 `idempotency: sender | none`）、`event`（`mail` 或 `github`，带过滤条件）或 `bot`（`from`、`mode: wait | dispatch`；自[执行结果、日历触发器与汇合](2026-11-23-bot-run-outcomes-calendar-joins.zh.md)起，`from` 是按链汇合的发送方列表），以及自该文起的 `calendar`。执行记录 `triggerIndex`；发生 ID 对 Bot、触发器索引和起因做哈希，因此重新投递的事件、重复的幂等键或重试的交接只对应一次执行。每个计划触发器在 `lastAdmittedAt` 中保留自己的水位。
- `overlap: skip | queue | parallel`（默认 `skip`）决定准入如何处理执行中的工作；`queue` 受 `queueDepth` 限制，`drain` 对非并行 Bot 的排队执行按时间顺序逐个启动。
- `connectors: 'all' | ConnectorId[]`（默认 `all`）由执行的工具守卫强制执行（`connectorOf` 映射 `mcp__<provider>_<id>__*` 与 `mail_*`），账户集成也通过 `ctx.automations.connectorBinding(sessionId)` 读取它，因此执行只挂载绑定的连接器。
- 已保存的批准根据 `grantLifetimeDays` 获得 `expiresAt`；过期的批准不再作答，新的回答会取代它。`/bots` 通过 `grant-revoke` 端点撤销批准。
- GitHub 事件到达 `/automation-webhook/<id>/github`，以 Bot 自己的密钥作为 GitHub secret 校验。这取代了把部署级 `webhook-github` 来源路由到账户的做法：那需要为每个来源维护所有者映射，而且没有任何发布的配置组合了它。
- 邮件事件来自基于 `ctx.mail.search` 的游标轮询：每 `mailPollSeconds` 对每个被关注账户做一次信封搜索，不启动模型轮次，第一次检查只记录收件箱。
- 交接是定义域与账户同步文档中的持久 `Handoff` 记录。任何可以运行接收方的 Host 都在接收方的占用下准入它，因此云端与桌面 Bot 之间的交接不需要专门的请求通道。`wait` 让发送方的执行结束，再把结果作为带 `replyTo` 的新交接交回，而不是占用发送方的执行槽位。
- 看板是一个命名的成员列表，带可选预算（`maxConcurrentRuns`、`maxTokensPerDay`）。准入会拒绝超出预算的执行，并把上限写入执行错误和交接原因。执行记录由其 `assistant/message` 事件累加得到的 `usage`。
- 每个执行对话都获得[执行结果、日历触发器与汇合](2026-11-23-bot-run-outcomes-calendar-joins.zh.md)中的结果工具。只有某个接收方指定了其 Bot 时，执行对话才获得 `bot_handoff`；只有看板成员才获得 `board_tasks` / `board_task_update`。`automation_*` 与 `ask_user` 守卫保持不变，因此执行仍不能创建 Bot、触发器、边、连接器绑定、批准或看板。
- 定义域保持版本 3。存储域没有迁移机制，升级版本会让所有已有存储在打开时被拒绝；因此定义模式把已保存的 `schedule` 读作第一个触发器，并使用 `connectors: all` 与 `overlap: skip`，已有 Bot 照常运行。

## 考虑过的替代方案

- **按 #740 的提议把定义域升到版本 4。** 不采用：打开时的 `version-mismatch` 会让每个拥有 Bot 的用户的服务停止。
- **邮件使用 IMAP IDLE。** 暂缓：IDLE 需要为每个账户保持一个连接，而连接池会关闭空闲连接；轮询直接复用 `ctx.mail`，每个间隔只花一次搜索。
- **看板范围的批准。** 暂不采用：批准保持按 Bot 划分，看板永远不会扩大单个成员的权限。

## 影响

- Slack、Discord、Telegram 与 WhatsApp 事件来源、每个 Bot 专属的邮箱地址以及托管浏览器仍在 #740 中待办。
- 事件去重以 Host 为单位；看板、交接及其携带的 token 数据在账户的各 Host 之间同步，而预算并发数只计算一台 Host 知道的执行。
