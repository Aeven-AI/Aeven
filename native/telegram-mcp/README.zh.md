# telegram-mcp（vendored）

[English](README.md) | 中文

Aeven 的 Telegram 连接器守护进程。此目录包含两部分：`source/` 下为
[`bstuff/telegram-mcp`](https://github.com/bstuff/telegram-mcp) 的固定版本副本，`aeven/` 下为连接器实际启动的
Aeven 自有守护进程入口。

| 组成 | 归属 | 作用 |
|---|---|---|
| `source/` | 上游，未修改 | 个人 Telegram 账户的 MCP 服务：`src/server.ts` 注册 33 个工具，`src/client.ts` 持有 teleproto 客户端及其会话 |
| `aeven/server.ts` | Aeven | 所提供的服务：上游的 33 个工具，加上注册在同一实例上的 Aeven 自有工具 |
| `aeven/main.ts` | Aeven | 可执行入口：构建登录适配器、启动守护进程、在 stdout 宣告地址，并在标准输入关闭时退出 |
| `aeven/daemon.ts` | Aeven | 回环 HTTP 守护进程：`/mcp` 提供 MCP，`/status`、`/login/*`、`/logout` 提供账户控制 |
| `aeven/auth.ts` | Aeven | 手机号 → 验证码 → 两步验证，或扫码 → 两步验证的可续登录状态机，替代上游的交互式 `bin/login.ts` |
| `aeven/qr.ts` | Aeven | 把每个 `tg://login` 令牌渲染为设置页面显示的 SVG 二维码 |
| `aeven/teleproto.ts` | Aeven | 基于 teleproto 的登录：将 Telegram 的回调挂起在控制端点所解析的值上 |
| `aeven/tools.ts` | Aeven | 哪些工具无需提示即可执行，以及 Aeven 自有工具的名称 |
| `aeven/refs.ts` | Aeven | Aeven 自有工具共用的参数与解析：按 id、@username、链接或名称定位一个人，以及在某个聊天内定位成员 |
| `aeven/rights.ts` | Aeven | 两套权限词表：提升管理员时授予的权限，以及群组对成员保留的权限 |
| `aeven/moderation.ts` | Aeven | 封锁、垃圾信息举报与成员管理：移出、封禁、解除封禁、列出封禁、提升、降级 |
| `aeven/groups.ts` | Aeven | 群组与频道管理：创建、加入、退出、名称与简介、成员权限、邀请链接 |
| `aeven/api.ts` | Aeven | 一个原始工具，可达 teleproto 提供的全部请求类，被拒绝的命名空间除外 |
| `scripts/build.ts` | Aeven | 将 `source/` 与 `aeven/` 编译到 `dist/`；连接器启动 `dist/aeven/main.js` |
| `tests/` | Aeven | 登录步骤处理、HTTP 接口、所提供的工具清单，以及 Aeven 自有工具的辅助逻辑，均无需 Telegram 凭据 |
| `dist/` | 构建产物，已忽略 | 生成的 JavaScript；Node 不会在 `node_modules` 下剥离类型 |

## 版本固定

上游提交 [`3615273ed9cb2ada6ceed0e190bba01cc815af43`](https://github.com/bstuff/telegram-mcp/commit/3615273ed9cb2ada6ceed0e190bba01cc815af43)
（2026-09-27），MIT 许可，许可证保存在 `source/LICENSE`。同步方式为：替换 `source/`、保留 `aeven/`、重新构建，并重跑
`tests/` 中的测试。

## 本地修改

`source/` 未作任何修改：Aeven 的全部新增内容都是 `aeven/` 下的独立文件，因此同步上游时直接替换该目录，无需回放补丁。
上游代码没有被覆盖。

## 守护进程契约

`node dist/aeven/main.js` 绑定 `127.0.0.1:0`，向 stdout 写入一行 JSON（这是它唯一的 stdout 输出）——
`{"listening":"127.0.0.1:<port>"}`——并提供：

| 路由 | 方法 | 作用 |
|---|---|---|
| `/mcp` | POST、GET、DELETE | 基于 Streamable HTTP 的 MCP |
| `/status` | GET | `{ state, phone, reason, identity, qr }`，其中 `state` 为 `login`、`code`、`qr`、`password`、`authorized`、`unlinked` 或 `failed`，`qr` 为 `qr` 状态下当前登录二维码的 SVG data URL；`?verify=1` 会同时向 Telegram 确认会话仍然有效 |
| `/login/start` | POST | `{ phone }` 发送登录验证码，并在 Telegram 送达后返回 |
| `/login/qr` | POST | 请求一个供 Telegram 应用扫描的登录令牌（设置 → 设备 → 关联桌面设备），在 Telegram 签发后返回；令牌会在过期前被替换，已启用两步验证的账户扫码后继续 `/login/password` |
| `/login/code` | POST | `{ code }` 完成登录，或报告需要两步验证密码 |
| `/login/password` | POST | `{ password }` 完成两步验证登录 |
| `/logout` | POST | 结束 Telegram 会话并清除已保存的会话字符串 |

所有路由都要求 `Authorization: Bearer <TELEGRAM_MCP_TOKEN>`；该令牌由连接器按进程生成并通过环境传入。
凭据与会话字符串不会出现在请求体或响应中。环境变量提供 `TELEGRAM_API_ID`、`TELEGRAM_API_HASH`、
`TELEGRAM_MCP_HOME`（Aeven 自有的账户目录，存放 `session`、`identity.json` 与 `downloads/`）以及
`TELEGRAM_MCP_TZ`。标准输入关闭后守护进程退出，因此宿主崩溃后不会遗留持有会话的进程。

验证码或两步验证密码被拒绝时，尝试会停留在同一步骤并报告 `reason`，用户可以重新输入；从未完成的尝试由连接器自身的
超时机制放弃。

读取类工具返回的 Telegram 内容是他人数据：连接器将其视为不可信数据，写入类工具需要用户批准。

## Aeven 自有工具

上游的 33 个工具保持原样。守护进程在同一服务上再注册 18 个，因此所提供的清单共有 51 个。`aeven/tools.ts` 记录
Aeven 自有工具的名称并标出其中三个只读的工具，一旦所提供的注解与该清单出现偏差，`tests/daemon.spec.ts` 即失败。
连接器在 `packages/host/account-integrations` 中镜像该只读清单用于其批准门控，因此任何会改变状态的工具都会先征求批准。

| 分组 | 工具 |
|---|---|
| 封锁 | `block_contact`、`unblock_contact`、`list_blocked` |
| 举报 | `report_spam` |
| 成员管理 | `kick_member`、`unban_member`、`list_banned`、`promote_member`、`demote_admin` |
| 群组与频道 | `create_group`、`join_chat`、`leave_chat`、`set_group_info`、`set_group_permissions` |
| 邀请链接 | `create_invite_link`、`list_invite_links`、`revoke_invite_link` |
| 原始访问 | `telegram_api_call` |

封禁与提升只存在于超级群；普通群没有封禁，因此在其中 `kick_member` 直接移出成员。封锁某人属于账户级操作，绝不会把他
从群组中移除。成员可以用 id、@username、链接或名称指定；当对话框缓存无法解析某个 id 时，会在工具所收到 `chat` 参数的
那个聊天中查找，因为成员列表携带着裸 id 所缺少的 access hash。

`telegram_api_call` 按名称访问 teleproto 生成 schema 中的任意请求类，因此命名工具未覆盖的能力无需修改守护进程。
`auth.*`、`account.*` 与 `payments.*` 命名空间被拒绝：登录、账户安全与真实资金支出都留在工具面之外。
