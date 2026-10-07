# discord-mcp

[English](README.md) | 中文

Aeven 的 Discord 连接器服务。连接器为每个已连接的服务器启动一个 stdio MCP 进程，因此模型在某个
服务器中工作时，可以读取它、向它发帖，并在部署允许时管理它，而无需在任何工具调用中指定服务器。

每个请求都以部署自有的 Discord 应用身份认证，请求头为 `Authorization: Bot <token>`。本包中不存在
用户令牌，也无法从本包触达 self-bot 路径：Discord 的用户令牌接口与网关接口从不被调用。

| 组成 | 作用 |
|---|---|
| `aeven/main.ts` | 可执行入口：校验环境变量、构建服务、通过 stdio 提供服务，并在标准输入关闭时退出 |
| `aeven/rest.ts` | REST 客户端：Bot 认证、有界的速率限制重试、多部分上传，以及固定的错误语句 |
| `aeven/format.ts` | 工具文本渲染：所有 Discord 产生的内容都置于 nonce 围栏内 |
| `aeven/refs.ts` | Discord 记录类型、频道类型名称、跳转链接，以及可读的消息文本 |
| `aeven/tools.ts` | 13 个精选工具 |
| `aeven/admin.ts` | 22 个管理工具，仅在启用时注册 |
| `aeven/moderation.ts` | 8 个审核工具，仅在启用时注册 |
| `aeven/lookups.ts` | 两套工具界面共用的服务器、频道与角色查询 |
| `aeven/vendor/` | 从上游复制的 Apache-2.0 代码片段；见 [`source/README.md`](source/README.zh.md) |
| `scripts/build.ts` | 将 `aeven/` 编译到 `dist/`；连接器启动 `dist/main.js` |
| `tests/` | 工具界面、REST 客户端、围栏、搜索、本地校验、上传请求体与环境变量校验，均不访问网络 |
| `dist/` | 构建产物，已加入 git 忽略 |

## 每个服务器一个进程

连接器为每个已连接的服务器启动一个子进程，并通过环境变量传入该服务器。服务器信息不出现在任何工具
参数中，因此模型无法访问未被连接的服务器，来自某个服务器的一条过期结果也无法指向另一个服务器的频道。
两个已连接的服务器就是两个进程，各自持有以令牌为作用域的客户端。

## 环境变量

| 变量 | 必填 | 含义 |
|---|---|---|
| `DISCORD_AUTHORIZATION` | 是 | 每个 Discord 请求的 `Authorization` 头值。Aeven 连接器传入 `Bearer <所有者的 Aeven 会话>`，并将 `DISCORD_API_BASE` 指向持有 Bot 令牌的 Aeven API Discord 代理。缺失或为空时进程拒绝启动。 |
| `DISCORD_GUILD_ID` | 是 | 本进程所服务的唯一服务器。 |
| `DISCORD_GUILD_NAME` | 否 | 在服务器查询结果填入缓存之前，工具输出中显示的服务器名称；不设置时首次查询会去获取该服务器。 |
| `DISCORD_ADMIN_TOOLS` | 否 | 为 `1` 时注册 30 个管理工具。其他任何值都只注册精选的 13 个。 |
| `DISCORD_MAX_SCAN_MESSAGES` | 否 | 单次 `search_messages` 扫描的消息上限，1–5000。默认 `500`。 |
| `DISCORD_MAX_FILE_BYTES` | 否 | `send_file` 可上传的最大文件，1–536870912。默认 `10485760`。 |
| `DISCORD_REQUEST_TIMEOUT_MS` | 否 | 单次逻辑调用的网络预算，1–300000。默认 `20000`。 |
| `DISCORD_API_BASE` | 否 | Discord REST 基地址。默认 `https://discord.com/api/v10`。 |

未设置或为空的变量取默认值；必填项或超出范围的取值会在启动时失败并指明变量名，绝不使用猜测值。
stdout 只承载 MCP 数据流，日志一律写入 stderr。

## 工具

### 精选界面 —— 始终提供

| 工具 | 参数 | Discord 调用 |
|---|---|---|
| `list_channels` | `type?` | 服务器的频道（不含线程）：id、名称、类型、分类、话题 |
| `get_channel` | `channel_id` | 单个频道或线程：名称、类型、分类、话题、慢速模式；若为线程还包含其父频道、创建者、计数与归档状态 |
| `get_messages` | `channel_id`、`limit?`（1–100，默认 50）、`before?`、`after?` | 按时间倒序的近期消息，格式为 `[id] ISO 时间 作者: 正文`，并附附件、嵌入与表情回应摘要。`before` 与 `after` 互斥 |
| `get_thread` | `thread_id`、`limit?`、`before?`、`archived?` | 线程自身的字段及其消息；`archived` 改为列出父频道的公开归档线程 |
| `search_messages` | `query`、`channel_id?`、`limit?`、`pages?`、`before?` | 在单个频道或服务器的文字频道中，对近期消息做大小写不敏感的子串匹配，受扫描预算限制，并给出覆盖行 |
| `list_members` | `limit?`（1–1000，默认 100）、`after?`、`query?` | 服务器成员及其显示名称与角色 |
| `get_guild_info` | 无 | 服务器自身记录：名称、id、所有者、计数、简介、加成等级、语言环境、功能、角色数量 |
| `send_message` | `channel_id`、`content`（1–2000） | 以 Bot 身份发帖；返回新消息 id 与跳转链接 |
| `reply_message` | `channel_id`、`message_id`、`content` | 发帖并引用该消息 |
| `add_reaction` | `channel_id`、`message_id`、`emoji` | 添加 Bot 自己的表情回应；`emoji` 为字形或 `name:id` |
| `remove_reaction` | `channel_id`、`message_id`、`emoji` | 移除 Bot 自己的表情回应 |
| `send_file` | `channel_id`、`file_path`、`caption?`、`reply_to_message_id?` | 从本机上传一个文件 |
| `create_thread` | `channel_id`、`message_id?`、`name`、`auto_archive_duration?`、`rate_limit_per_user?` | 创建线程：指定消息时挂载于该消息，否则创建独立线程 |

### 管理界面 —— `DISCORD_ADMIN_TOOLS=1`

| 分组 | 工具 |
|---|---|
| 角色 | `list_roles`、`create_role`、`edit_role`、`delete_role`、`assign_role`、`remove_role` |
| 成员 | `kick_member`、`get_member`、`edit_member`、`timeout_member`、`clear_timeout` |
| 封禁 | `list_bans`、`get_ban`、`ban_member`、`bulk_ban_members`、`unban_member` |
| 消息 | `delete_messages`、`purge_messages` |
| 频道 | `create_channel`、`edit_channel`、`delete_channel`、`set_channel_permissions` |
| 邀请 | `list_invites`、`revoke_invite` |
| AutoMod | `list_automod_rules`、`create_automod_rule`、`edit_automod_rule`、`delete_automod_rule` |
| 审核日志 | `read_audit_log` |
| 服务器 | `edit_guild` |

默认关闭：只有管理员设置该变量时，部署才会提供这些名称，且每次调用都可带一个可选的 `reason`，
由 Discord 记入审计日志。它们所需的权限位由部署决定，而非本包。

踢出、封禁与角色工具要求 Bot 的最高角色高于目标，Bot 既不能踢出也不能禁言服务器所有者，
且 Bot 设置的禁言不会超过 28 天的上限。

## Bot 在 Discord 开发者门户中需要什么

- **Message Content intent（消息内容意图）。** 未启用时 Discord 返回空的消息正文，`get_messages`
  与 `search_messages` 只能报告组件与嵌入所携带的文本。
- **Server Members intent（服务器成员意图）。** `list_members` 与 `get_member` 读取
  `GET /guilds/{id}/members`，在管理员为 Aeven 应用启用这一特权意图之前，Discord 会以 403 拒绝。
  该拒绝会作为这一前置条件报告，而不是笼统的权限错误。
- **安装在授权时请求的权限位。** 精选界面需要 View Channels、Read Message History、Send Messages、
  Send Messages in Threads、Create Public Threads、Attach Files、Add Reactions 与 Embed Links。
  同时提供管理界面的部署还需 Manage Roles、Manage Channels、Kick Members、Ban Members、
  Moderate Members、Manage Messages、Manage Threads、Move Members、Manage Server 与
  View Audit Log。若某个频道或角色拒绝了其中一项，Discord 会报告权限错误；那是服务器自身的设置。
- **Bot 必须在服务器中。** 查询被 Discord 以 403 或 404 答复，意味着 Bot 已退出该服务器，或该服务器
  已不存在。

## 搜索

Discord 的服务器级全局搜索接口只接受用户令牌，因此本包从不调用它。`search_messages` 改为逐页遍历
`GET /channels/{id}/messages`：指定 `channel_id` 时只遍历该频道，否则遍历服务器的全部文字频道与公告
频道，总数不超过 `DISCORD_MAX_SCAN_MESSAGES` 条消息。匹配的是可读文本中大小写不敏感的子串 —— 先取
消息正文，再取 Components V2 的 `TextDisplay` 片段，最后取嵌入的标题、描述、字段与页脚 —— 并对每个
匹配报告其频道与跳转链接。最后一行说明扫描覆盖了多少条消息、多少个频道，以及扫描是完整完成还是被预算
截断。结果只覆盖该行所报告的时间窗口，而非全部历史。

## 不可信内容

频道名称、话题、服务器名称、成员名称、角色名称、消息正文、嵌入文本与文件名都属于他人的文本。它们进入
工具输出时一律置于由全新 16 位十六进制 nonce 围起的区块内 ——
`<untrusted_discord_messages nonce="…">…</untrusted_discord_messages>` —— 其中任何形似的标签都会在写出
前被拆解，因此 Discord 内容无法闭合自身的围栏。状态行与错误语句由本包撰写，保持在围栏之外。错误从不
重复 Discord 的响应正文；它们只携带固定语句与 HTTP 状态码。

## 引入的上游子集

nonce 围栏、十进制权限字符串与雪花 id 模式来自
[`cappyeo/discord-mcp`](https://github.com/cappyeo/discord-mcp) 的提交
`7ed828f9979f261fbb3ce94c440a8f46c28b5716`（2026-10-03），Apache-2.0，位于 `aeven/vendor/` 下。上游的
工具模块、中间件与访问管线、网关客户端以及组装机制均未引入：精选的 13 个与管理 30 个已取代它们。
[`source/README.md`](source/README.zh.md) 记录了每个复制的文件、唯一的一处本地修改，以及每个改为在本包
实现的候选项。

## 构建与测试

```sh
pnpm --dir native/discord-mcp run build      # emits dist/main.js
npx vitest run native/discord-mcp/tests      # from the repository root
npx tsc --noEmit -p native/discord-mcp/tsconfig.build.json
```

## 已知限制与后续工作

- **没有网关，也没有事件监听。** 该进程由请求驱动：它不持有 Discord websocket，只有在工具读取频道时
  才知道有新消息。实时投递 —— 收到消息、新增表情回应、成员加入 —— 留待后续变更连同其进程设计一并
  完成。
- **速率限制处理是进程内的。** 每个子进程只遵守 Discord 返回给它的 429 等待与桶重置提示，最多重试
  三次并有固定的最长等待。服务两个服务器的两个进程之间不共享对全局桶的认识，也不存在跨进程队列。
- **消息正文为纯文本。** `send_message` 与 `reply_message` 只发送字符串，因此嵌入、Components V2
  结构、投票、贴纸与论坛帖子均留待后续；`send_file` 每次只上传一个文件。
- **搜索是有界的遍历。** Discord 的服务器搜索接口只接受用户令牌，因此结果只覆盖单次调用所请求的页，
  而非全部历史。早于该窗口的查询返回空结果而非部分答案，覆盖行会清楚说明这一点。
