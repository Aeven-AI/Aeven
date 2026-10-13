# Agent Note：WhatsApp 连接器为每个已关联号码运行一个 vendored Go 守护进程

Status: implemented

[English](2026-10-06-whatsapp-connector-daemon.md) | 中文

## Problem

在此之前的每个连接器都是宿主所持有凭据之上的挂载：OAuth 授权、bearer token，或用户自备的 MCP 端点，覆盖 GitHub、Google 各项服务、Microsoft 365 与自定义 MCP。WhatsApp 账户不属于其中任何一种。账户是通过扫描二维码与手机关联的设备，其凭据是客户端会话而不是宿主拥有的记录；工具面是有状态的——守护进程在对话之间缓存收到的消息，并按聊天按需回填历史；取消关联必须在 WhatsApp 侧结束会话，而不是丢弃一个 token。执行器门控也只按 `mcp__account_<id>__` 前缀识别连接器工具，因此提供商必须挂载在该命名空间下才会受到管控。

## Decision

将 [Sealjay/mcp-whatsapp](https://github.com/Sealjay/mcp-whatsapp) 按提交 `ee039b67234a5216bda4e9a88c4e2fe1a2beae6f` 固定 vendored 到 `native/whatsapp-mcp/source/`，并由 `native/whatsapp-mcp/scripts/build.ts` 为每个平台编译出一个可执行文件。其 `go.mod` 采用纯 Go 驱动 `modernc.org/sqlite`，因此在 `CGO_ENABLED=0` 下可从任意构建主机交叉编译全部六个目标。每个目标的二进制打包为 `@aeven/whatsapp-mcp-<platform>-<arch>`，由 `@aeven/host-account-integrations` 作为可选依赖持有并在启动时解析；`whatsappBinaryPath` 可显式指定二进制路径。

宿主为每个已关联号码监管一个守护进程（`packages/host/account-integrations/src/whatsapp.ts`）：

- `WhatsAppDaemon` 启动 `whatsapp-mcp -store <directory>/store serve -addr 127.0.0.1:0 -exit-on-stdin-eof`，并把 `media/` 目录作为 `WHATSAPP_MCP_MEDIA_ROOT` 传入；两者都建在该账户的连接器目录下，权限为 0700。子进程只继承 PATH、主目录、临时目录与 Windows 系统变量以及 LANG，另加每个进程新生成的 32 字节 bearer token；任何提供商密钥或宿主凭据都不会传入。
- 守护进程绑定由操作系统选择的回环端口，并把 `{"listening":"127.0.0.1:<port>"}` 作为唯一的 JSON stdout 行输出。超过 `whatsappStartupTimeoutMs` 或进程提前退出即判定启动失败。`/mcp`、`/status`、`/logout` 三条路由都要求 bearer token，因此找到该端口的本地进程仍无法读取账户或结束其会话。
- 宿主保持子进程的标准输入打开，守护进程在其关闭时退出，因此宿主崩溃不会留下占用 store 的 `flock` 的进程。`stop()` 先关闭标准输入，仅在 `whatsappStopGraceMs` 之后才发送 SIGKILL。
- 非预期退出会按指数退避从 `whatsappRestartDelayMs` 递增至 `whatsappMaxRestartDelayMs` 重启守护进程；一次运行超过最大退避时长后计数归零，且仅在该行仍处于启用且已关联状态时才安排重启。启动失败不再安排重启，由下一次对话步骤或设置页面操作重试。

关联是由宿主拥有的尝试过程，而不是一次重定向：`startWhatsAppPairing` 创建行并启动守护进程，设置页面渲染 `/status` 返回的 QR PNG，手机扫码后该号码才成为已关联连接器。`logout()` 在 WhatsApp 侧结束会话并清除本地会话；移除连接器会停止守护进程并删除其目录。一个所有者最多关联 `maxWhatsAppAccounts` 个号码，每个号码保留一行记录、一个数据目录、一个守护进程和一个 `mcp__account_<id>__` 命名空间。

守护进程的工具通过既有 MCP 挂载路径在每次对话步骤前挂载；执行器门控会拒绝已禁用、属于他人或未连接的连接器的全部工具。十五个只读取账户或把媒体下载到其自身目录的工具——`list_messages`、`list_chats`、`get_chat`、`get_message_context`、`search_contacts`、`is_on_whatsapp`、`get_status`、`pairing_status`、`download_media`、`get_poll_results`、`list_groups`、`get_group_info`、`get_blocklist`、`get_privacy_settings`、`request_sync`——之外的每个 WhatsApp 工具都会先请求审批，因为其余操作对其他人可见。

针对 Desktop 应用，包集合会打包对应目标的 tarball（`packedWhatsApp`），seed 以 `file:./desktop-packages/aeven-whatsapp-mcp-<platform>-<arch>-0.1.0.tgz` 安装它。发布的应用从自身的 store 解析该守护进程：安装期间不执行任何构建步骤，首次启动也不需要网络访问。

## Alternatives considered

**让用户自行安装守护进程，并通过自定义 MCP 提供商挂载。** 该提供商已支持存储端点与可选的 bearer token，并在同一 `mcp__account_<id>__` 前缀下挂载工具，因此无需 vendoring、无需平台包，也无需桌面打包。弃用原因：决定连接器状态的信息属于账户而非端点——关联尝试必须跨多个浏览器请求保持，`/status` 必须在对话之间回答号码是否仍然关联，取消关联必须在 WhatsApp 侧结束会话。用户自备的端点这三者都不提供。

**在宿主进程内直接实现多设备协议。** 在宿主中用 Node 客户端实现可以省去 vendored 目录、六个平台包以及 seed 中的 tarball。弃用原因：这会把协议、其 SQLite store 以及文件锁搬进运行对话的进程——`whatsmeow` 是得到维护的实现，而独立进程能让协议崩溃、store 加锁失败或会话损坏不至于连带拖垮对话。

**在安装时编译守护进程，而不是发布二进制。** 弃用原因：这会让每台构建主机都需要 Go 工具链，并在桌面项目经过评审的 `allowBuilds` 策略中新增一个生命周期脚本，而未被列出的脚本是硬性安装错误。在打包时构建可让发布的 store 不含构建步骤及其网络依赖。

## Consequences

在 macOS arm64 的 seed 中，关联一个号码的代价是 8,957,022 字节的 tarball 与 25,667,074 字节的解包守护进程，相对于 877 MB 的应用与 342 MB 的 dmg。发布时只包含所构建目标的那个包；另外五个平台包服务于其他桌面目标与 GitHub 上的连接器。

没有任何凭据记录保存 WhatsApp 会话，因此任何 Remote 响应、工具结果或设置页面视图都无法泄露它：守护进程自身的 store 是唯一副本，这也意味着删除该目录是会话异常时唯一的恢复方式，重新关联需要重新扫描二维码。每个已关联号码在其行保持启用且已关联期间都会持续运行一个进程，因为消息会在对话之间到达；`maxWhatsAppAccounts` 限制了一个所有者能以这种方式承载的号码数量。

用真实号码配对仍是手工步骤：没有自动化测试用手机扫描二维码，也没有测试把账户完整走一遍关联、首条消息与取消关联。vendored 源码保留在上游的 Go 测试文件（`native/whatsapp-mcp/source/`），它们验证的是守护进程本身，而不是宿主对它的监管。

## Related

[个人技能与连接器](2026-10-04-personal-skills-and-connectors.zh.md)拥有本提供商所扩展的连接器归属模型：记录由通过认证的账户拥有，工具注册在所属 agent 的作用域内，执行器拒绝已禁用、已删除及属于他人账户的连接。

[Telegram 连接器为每个账户运行一个 vendored Node 守护进程](2026-10-07-telegram-connector-daemon.zh.md)复用了这一形态，并记录了其上游构件三点不同之处。
