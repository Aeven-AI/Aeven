# Agent Note：Telegram 连接器为每个账户运行一个 vendored Node 守护进程

Status: implemented

[English](2026-10-07-telegram-connector-daemon.md) | 中文

## Problem

WhatsApp 连接器为“账户本身是设备或会话、而不是 OAuth 授权”的消息类提供商确立了形态：宿主为每个已关联账户持有一个受监管的守护进程，按对话挂载该守护进程的工具，并由设置页面驱动配对。Telegram 需要同样的形态，但其上游构件在三点上不同，这三点决定了实现方式：

- [`bstuff/telegram-mcp`](https://github.com/bstuff/telegram-mcp) **只支持 stdio**。其入口把 stdout 留给 JSON-RPC，因此无法从中读取已绑定地址或登录状态。
- 登录是**交互式 CLI**（`bin/login.ts`，基于 readline 的终端交互）。手机号 → 验证码 → 两步验证的流程没有机器接口，浏览器也无法驱动终端提示。
- 会话是文件中的 **teleproto 会话字符串**，而不是守护进程加锁并缓存的目录，且整个流程需要 `my.telegram.org` 的应用凭据。

## Decision

将上游源码按固定提交 vendored 到 `native/telegram-mcp/source/`，并把 Aeven 的全部新增内容放在 `native/telegram-mcp/aeven/` 下的独立文件中，因此同步上游时直接替换目录，无需回放补丁。新增内容为：

- `aeven/daemon.ts`——回环 HTTP 守护进程：通过 Streamable HTTP 传输挂载上游 `createServer()` 的工具清单；把 `{"listening":"127.0.0.1:<port>"}` 作为唯一的 stdout 行输出；标准输入关闭时退出；所有路由都要求按进程生成的 bearer token。它新增 `/status`、`/login/start`、`/login/code`、`/login/password` 与 `/logout`，与 WhatsApp 守护进程的 `/status` 和 `/logout` 相对应。
- `aeven/auth.ts`——以可注入端口实现的可续登录状态机，因此步骤处理与 HTTP 接口无需网络或真实账户即可测试。
- `aeven/teleproto.ts`——端口的 teleproto 实现。Telegram 客户端只提供一次带回调的长时 `start()`，因此每个回调挂起在一个延迟值上，由控制端点解析；被拒绝的步骤会重新挂起该延迟值，使用户可以在同一步骤重新输入验证码或密码。
- `aeven/server.ts`、`aeven/tools.ts`、`aeven/refs.ts`、`aeven/rights.ts`、`aeven/moderation.ts`、`aeven/groups.ts` 与 `aeven/api.ts`——上游没有提供的工具。`createTelegramServer()` 把它们注册到上游的服务上，因此所提供的清单是上游的 33 个加上 18 个：封锁与垃圾信息举报、成员管理、群组与频道设置、邀请链接、加入与退出，以及一个按名称访问 teleproto 生成 schema 中任意请求类的原始工具。`aeven/refs.ts` 按 id、@username、链接或名称解析一个人，并在对话框缓存无法解析某个 id 时，到工具所收到的那个聊天的成员列表中查找，因为该列表携带着裸 id 所缺少的 access hash；`aeven/rights.ts` 把工具接受的权限名称映射到 Telegram 实际放到线上的字段。

连接器为每个账户保留一行记录、一个数据目录、一个守护进程和一个 `mcp__account_<id>__` 命名空间，与 WhatsApp 完全一致，并按 Telegram 用户 id（而非手机号或名称）拒绝重复登录同一账户。

部署的应用标识保存在 Aeven API 上（[连接器密钥位于 Aeven API](2026-10-07-connector-secrets-on-aeven-api.zh.md)）。宿主以已登录用户的会话读取它们，并缓存在其凭据提供方中，使已关联的账户可在启动时运行，且仅在子进程环境中传递。浏览器响应、工具 schema 或模型请求都不携带它们，用户也无需访问 `my.telegram.org`。每个 MTProto 客户端都会出示这些标识，它们只标识应用，不授予任何账户权限。

权限遵循工具注解：标记 `readOnlyHint` 的 20 个工具——上游的 17 个加上 Aeven 的三个清单类工具——直接执行，其余 31 个会改变真实账户的工具仍由现有 `ask` 门控把关。一旦所提供的注解与 `aeven/tools.ts` 出现偏差，`native/telegram-mcp/tests/daemon.spec.ts` 即失败，`packages/host/account-integrations` 为其门控镜像该清单。

## Alternatives considered

**通过 `@aeven/mcp-client` 直接挂载上游 stdio。** MCP 客户端已支持 `transport: 'stdio'`，Google 连接器正是以该方式启动 Node MCP 子进程，因此无需修改 vendored 代码。弃用原因：进程将由每次对话的挂载点而非连接器持有——没有地方跨浏览器请求保存登录尝试，没有 `/status` 可读，也没有地方在取消关联时结束会话。

**仅将上游 CLI 分叉为可编程登录。** 当标准输入不是终端时，通过向其 stdin 写入来驱动 `login.ts` 是可行的，但这意味着要解析提示文本与错误文本，而两步验证提示是刻意隐藏的。对凭据流程而言过于脆弱，故弃用。

**改用同名的 Python 版 `bssth/telegram-mcp` 实现。** 该同名仓库为 Python + telethon，需要在 Desktop seed 中提供 Python 运行时。弃用原因：方案选定的 Node/TypeScript 上游以纯 JavaScript 分发，可直接运行在宿主已经启动的 Node 上。

## Consequences

Desktop 包集合会打包一个编译后守护进程的 tarball（`packedTelegram`），因为 `native/` 不属于 `avn` 发布族；连接器从 `@aeven/telegram-mcp` 解析该包，并用宿主自身的运行时启动它，因此不涉及外部 Node、npm 或 npx。

`native/telegram-mcp/tests/` 覆盖登录步骤、令牌门控、控制路由、所提供的 51 个工具清单、Aeven 自有工具的辅助逻辑，以及作为子进程运行的构建产物入口。真实 MTProto 未被覆盖：登录真实账户需要部署方已注册的应用以及手机号、验证码和两步验证密码，因此这仍是手动步骤（记录在包 README 的已知限制中）。

上游只提供消息、读取、媒体与投票类工具，管理员需要的能力一概没有，因此审核与管理由 Aeven 自有工具承担。它们覆盖 Telegram 自家客户端通过 MTProto 执行的操作：封锁、垃圾信息举报、封禁与提升、群组设置、邀请链接，以及加入或退出。封禁与提升只存在于超级群，因此普通群的移出是另一次调用，而 `block_contact` 从不把任何人移出群组。封锁与解除封锁在报告成功之前会回读账户自身的封锁状态，因为 Telegram 对这些调用返回的只是一个无需轻信的标志位。schema 中其余能力都可以通过 `telegram_api_call` 触达，代价是按 schema 的形状组织调用，从而不必为每种能力各加一个工具；该处拒绝 `auth`、`account` 与 `payments`，因此登录、账户安全与真实资金支出仍在工具面之外。
