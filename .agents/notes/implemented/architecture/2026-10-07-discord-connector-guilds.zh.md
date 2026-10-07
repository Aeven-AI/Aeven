# Agent Note：Discord 以“每个服务器一行连接器”接入，背后是同一个 Aeven 应用

Status: implemented

[English](2026-10-07-discord-connector-guilds.md) | 中文

## Problem

WhatsApp 和 Telegram 为“账户是设备或会话、而不是 OAuth 授权”的提供商确立了账户连接器的形态：每个账户一行连接器，每行一个受监管的进程，每行一个 `mcp__account_<id>__` 工具命名空间，登录由设置页面驱动。Discord 打破了这一形态的三个前提。

- 用户连接的单位不是账户，而是**服务器**（guild）：用户把自己的机器人加入其中，同一个人可以加入多个。若按提供商账户建行，多个服务器将共用一行、一个命名空间和一个开关，工具调用也可能落到错误的服务器上。
- 凭据不是用户的。Discord 机器人使用应用自身的机器人令牌认证，而上游构件 [`cappyeo/discord-mcp`](https://github.com/cappyeo/discord-mcp) 假定调用方自己拥有机器人并以 `DISCORD_TOKEN` 传入。Aeven 的要求恰好相反：一个 Aeven 自有应用，任何用户都可将其安装到任何服务器，不需要用户创建机器人，也不使用用户令牌。
- 工具面无法照搬。上游提供 221 项工具——其中包括角色、AutoMod、付费、语音、模板、服务器蓝图、组件、智能分析与 webhook 管理。全部挂载会让每个对话都出现一份既无法解释、又大多无关的工具目录。

## Decision

`discord` 是一等的 `ConnectorProvider`，其**连接单位是一个服务器**：每个服务器一行连接器、一个连接器 id、一个 `mcp__account_<id>__` 命名空间，以及各自独立的启用与移除开关；而所有行背后都是同一个 Aeven Discord 应用与机器人。

Aeven API 的连接器代理拥有 Discord 应用以及所有需要其凭据的 Discord 调用（[连接器密钥位于 Aeven API](2026-10-07-connector-secrets-on-aeven-api.zh.md)）：安装交换（以授权码、PKCE verifier、客户端 id 与客户端密钥调用 `POST /oauth2/token`）、读取安装者、成员检查（`GET /guilds/{id}`）、机器人身份（`GET /users/@me`）以及退出服务器。安装链接是 Discord 的机器人授权页面：`authorize('discord')` 请求 API 以 `scope=bot applications.commands identify`、所提供工具面的权限位域和绑定账户的 PKCE state 发起授权。API 在其回调中兑换授权码、确认机器人已是成员，并记录服务器、安装者和机器人；宿主在下一次读取设置时据此写入一行。安装到账户已连接的服务器会刷新该行，连接器 id 由账户与服务器 id 派生，因此卸载后重新安装工具名称不变。`maxDiscordGuilds` 限制一个账户可持有的行数；超出限制的安装会在 API 上被再次移除。

该行保存 `applicationId`、`botUserId`、`guildId`、`guildName`、可选的图标 URL、Discord 报告时的安装者 id 与名称，以及 `linked`（机器人不再是成员时变为 false）。客户端密钥与机器人令牌保留在 API 上，因此任何行、宿主进程、工具 schema、模型请求或浏览器响应都不携带密钥，服务器行也没有自己的凭据记录。

每个服务器通过现有 MCP 客户端以 **stdio 子进程**运行自己的连接器服务：服务器 id、指向该服务器 API Discord 代理的 `DISCORD_API_BASE`，以及携带所有者 Aeven 会话的 `DISCORD_AUTHORIZATION` 放在其环境中，`cwd` 使用客户端的默认值。代理仅对所有者安装了机器人的服务器内的路径以机器人身份操作。一个进程只服务一个服务器，因此没有工具接受服务器参数，两个服务器也无法混用；进程随服务器挂载启动、随其销毁，并在所有者会话轮换时以新会话重启，因此连接器无需守护进程管理、回环端口或自己的重启策略。宿主每行至多每 `discordVerifyIntervalMs` 通过代理重新读取一次服务器成员关系，从而在不于每个对话步骤询问 Discord 的情况下，把被移除的机器人变成已断开的行。

该服务即 [`native/discord-mcp`](../../../../native/discord-mcp/README.zh.md)：需求中列出的精选工具面——`list_channels`、`get_channel`、`get_messages`、`get_thread`、`search_messages`、`list_members`、`get_guild_info`、`send_message`、`reply_message`、`add_reaction`、`remove_reaction`、`send_file`、`create_thread`——外加覆盖成员（踢出、封禁、批量封禁、解除封禁、成员信息读取与编辑、禁言）、消息（删除与清理）、角色、频道与权限、邀请、审计日志、AutoMod 与服务器设置的 30 项管理与审核工具，仅在 `discordAdminTools` 开启时注册。安装链接请求部署方所提供工具面对应的权限，`discordPermissions` 可整体替换该位域。`search_messages` 在扫描预算内遍历消息，而不调用 Discord 保留给用户账户的搜索路由。

批准门控按三个工具面划分：七项读取工具直接执行；发送、回复、回应、上传与创建主题这六项作为可见操作征求批准；每项管理与审核工具都单独征求批准，并在提示中说明这是对整个服务器的更改。

卸载时会在 Discord 允许的情况下通过 `DELETE /users/@me/guilds/{id}` 退出服务器，然后删除该行。部署方无法完成的退出——Discord 不可达、Discord 拒绝移除机器人——仍会删除本地行，因为用户要求的是让该连接消失。

## Alternatives considered

**整体 vendor 上游，并按配置关闭分类。** 上游是一个 TypeScript monorepo，其工具经过自身的 `defineTool` 流水线、访问需求注册表与审计中间件运行。整体提供服务意味着要一并交付这些机制，然后说明 221 项工具中哪些被关闭；而其工具名称（`channels_list`、`messages_read`）也不是本连接器的批准门控与技能所依据的名称。因此拒绝：只 vendor REST 与消息投影辅助代码，精选工具面为 Aeven 自行编写。

**Discord 只建一行连接器，每项工具都接受服务器参数。** 行数更少，也不需要每服务器一个子进程。拒绝：单一命名空间意味着所有服务器共用一个启用开关，模型必须传入一个它无法验证的服务器 id，而且对“绝不误混服务器”没有任何结构性保障。

**像 WhatsApp 和 Telegram 那样，每行一个带回环 HTTP 端点的守护进程。** 这里拒绝，是因为那些守护进程存在的意义是持有*会话*——WhatsApp 的设备关联、Telegram 的登录——会话必须在对话之间、跨浏览器请求保持存活。Discord 没有需要按连接器持有的会话：机器人令牌属于部署方，而 MCP 客户端的 stdio 传输已经拥有挂载所需的子进程生命周期。

**每个用户各自的 Discord 应用。** 直接拒绝：那将要求每个用户在开发者门户中创建机器人，而这正是此连接器要避免的事情。

**管理与审核工具默认常开。** 拒绝：默认存在的审核工具面会改变每个部署的批准对话、所请求的权限与误封禁的风险，包括那些只想读取和发布的部署。

## Consequences

添加服务器需要 Aeven API 上的 Aeven Discord 应用——客户端 id、客户端密钥与机器人令牌——并为其启用消息内容与服务器成员特权意图，同时在该应用上注册 API 的回调地址。该注册是由人在开发者门户中完成的操作；代码路径在没有它时也完整，凭据缺失时 API 将该提供方报告为未配置。测试不会对 Discord 进行真实安装；API 的安装交换、成员检查、代理守卫与卸载在 `servers/node` 中针对替换的 `fetch` 固定。

Discord 的 Gateway 不在范围内：新消息与提及在对话请求时才读取，用于实时事件的监听器尚未实现。Discord 的服务器级搜索路由对机器人同样不可用，因此 `search_messages` 报告其扫描窗口，而不会声称覆盖完整历史。

`packages/host/account-integrations/src/index.ts` 中的批准门控工具列表与 `native/discord-mcp` 注册的名称相互对应，正如 Telegram 连接器那样。与会在注解和宿主列表漂移时让自己的测试失败的 Telegram 守护进程不同，Discord 这一对没有任何自动检查：原生包固定其提供的名称，宿主列表则靠人工维护。

管理与审核工具还需要在安装时授予相应权限。若服务器是在 `discordAdminTools` 关闭时安装的，打开该开关不会为其增加权限；必须重新添加该服务器。
