# 引入的上游子集

[English](README.md) | 中文

本包从 [`cappyeo/discord-mcp`](https://github.com/cappyeo/discord-mcp) 保留的 Apache-2.0 代码片段，以及刻意不引入的部分。

| | |
|---|---|
| 上游 | `https://github.com/cappyeo/discord-mcp` |
| 克隆的提交 | `7ed828f9979f261fbb3ce94c440a8f46c28b5716`（2026-10-03，`perf: reduce discovery and initialization overhead in v0.31.1 (#77)`） |
| 许可证 | Apache-2.0，保存在 [`LICENSE`](LICENSE) |
| 克隆方式 | `git clone --depth 1 https://github.com/cappyeo/discord-mcp /tmp/upstream-discord-mcp`，只读 |

## 复制的文件

引入的 TypeScript 位于 `aeven/vendor/` 下而非 `source/` 下，因为 `tsconfig.build.json` 以 `rootDir: "aeven"` 将 `aeven/**` 编译到 `dist/`。`source/` 承载署名记录与本清单。

| 上游路径 | 保留于 | 导入 | 保留原因 |
|---|---|---|---|
| `LICENSE` | `source/LICENSE` | — | Apache-2.0 要求许可证随复制的文件一同提供。 |
| `packages/mcp-core/src/tools/_lib/untrusted.ts` | `aeven/vendor/untrusted.ts` | `node:crypto` | nonce 围栏：每个区块一枚全新的 8 字节 nonce，以及用于拆解文本中形似标签的扫描。本包工具输出中的每个 Discord 内容都经过 `wrapUntrusted` 或 `wrapMessages`。 |
| `packages/mcp-core/src/tools/_lib/permissions.ts` | `aeven/vendor/permissions.ts` | `zod` | `PermissionString` 把 Discord 权限位以十进制字符串保存，因为该位域超出 `Number.MAX_SAFE_INTEGER`。`set_channel_permissions` 的 `allow` 与 `deny` 参数经由它传入。 |
| `packages/mcp-core/src/tools/_lib/snowflake.ts` | `aeven/vendor/snowflake.ts` | `zod` | 带品牌的 id 模式。`ChannelId`、`MessageId`、`UserId` 与 `RoleId` 是工具参数模式，在构造请求之前就拒绝任何非 17–20 位雪花 id 的取值；`Snowflake` 是不带品牌的基类，用于既非频道也非用户等 id。该文件其余的品牌属于上游词表，此处未使用。 |

复制的文件保留上游的排版与分号；`native/**` 不在仓库的 lint 程序范围内（[`.oxlintrc.json`](../../../.oxlintrc.json) 已忽略它）。

## 本地修改

有一个文件与上游不同。

`aeven/vendor/untrusted.ts` 为 `UntrustedKind` 增加了本包渲染的十种类型 —— `messages`、`channels`、`members`、`roles`、`guild`、`thread`、`bans`、`automod_rules`、`invites`、`audit_log` —— 因为上游的词表（`message`、`embed`、`webhook`、`username`、`channel_topic`、`template`、`audit_reason`）命名的是单个值，而这些工具返回的是记录集合。围栏机制、nonce、拆解扫描与 `wrapMessages` 均未改动。同步时重新应用新增的十个联合成员即可。

## 未复制的候选项

上游有两个候选项引入了项目内部或受限的导入，因此改为在本包提供等价实现。

| 上游路径 | 等价实现 | 未复制原因 |
|---|---|---|
| `packages/mcp-core/src/tools/_lib/message-jump-url.ts` | `aeven/refs.ts` —— `jumpUrl` | 它导入 `@sapphire/pieces` 的依赖注入容器，以及 `../../rest/channel-guild-cache.js` 来解析频道所属的服务器。本包的服务器由 `DISCORD_GUILD_ID` 固定，服务器 id 始终已知，因此不存在频道到服务器的缓存。 |
| `packages/mcp-core/src/tools/messages/_lib/message.ts` | `aeven/refs.ts` —— `readableMessageText`、`componentText`、`embedText` | 它导入 `discord-api-types/v10` 以取得 `ComponentType.TextDisplay`。本包只依赖 `@modelcontextprotocol/sdk` 与 `zod`，因此该模块所读取的 Components V2 编号（`10`）改为在 `refs.ts` 中直接写明。 |

## 刻意不引入的部分

上游是一个单仓库，其另外三个包与约 275 个工具模块，服务于一个多服务器、多租户、由容器组合的服务。本包以一个固定服务器下的 13 个精选工具与 30 个管理工具取代该界面，因此以下内容被有意排除。

- **`packages/mcp-core/src/tools/` 下的工具模块**（`app_emojis`、`application`、`audit_log`、`automod`、`channels`、`commands`、`components-v2`、`emojis`、`events`、`guild`、`inspiration`、`intelligence`、`interactions`、`invites`、`members`、`messages`、`meta`、`monetization`、`onboarding`、`permissions`、`polls`、`reactions`、`roles`、`soundboard`、`stage_instances`、`stickers`、`templates`、`threads`、`users`、`voice`、`webhooks`，以及发现与注册层）。`aeven/tools.ts`、`aeven/admin.ts` 与 `aeven/moderation.ts` 基于 `aeven/rest.ts` 定义了本连接器所提供的 43 个调用。
- **中间件与访问管线**（`middleware/`、`access/`、`preconditions/`、`pipeline/`、`identity-lock.ts`、`config.ts`）。服务器白名单、按服务器区分的身份与载荷审批属于多服务器服务；此处服务器只是一个环境变量，审批由 Aeven 自身的审批门负责。
- **网关客户端**（`gateway/`）。本服务基于 stdio 由请求驱动，不持有 Discord websocket。
- **组装与预览机制**（`tools/messages/_lib/composer.ts`、`tools/messages/_lib/delivery.ts`、`apps/`、`resources/`、`workflows/`、`stores/`、`pieces/`、`audit/`、`telemetry/`、`capabilities/`、`container.ts`）。它在发送前构建并校验复杂的组件树；本包只发送纯文本、单个文件与表情回应。
- **`packages/mcp-server` 与 `packages/mcp-server-mocks`**。它们是部署的入口、传输装配与 HTTP 测试替身；连接器改为启动 `dist/main.js`，`tests/` 中的测试套件则替身 `globalThis.fetch`。
