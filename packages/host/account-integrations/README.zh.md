---
description: "个人技能包和账户所属的远程 MCP 连接。"
kind: "package-reference"
---

# @aeven/host-account-integrations

[English](README.md) | 中文

## Summary

已登录用户可导入、查看、启用和移除自己的技能、连接远程 MCP 服务器、关联 WhatsApp 号码并登录 Telegram 账户。每项管理操作均从已认证请求确定所属账户。技能和连接器凭据在重启后保留；对话仅获得其所属账户的集成。

## Table of Contents

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

## Use this package

Web bundle 将此插件与[技能和连接器页面](../../client/ui-settings-integrations/README.zh.md)一起挂载。设置列出账户的个人导入、部署默认预设的技能，以及该账户拥有的每个文件夹工作区中的技能。列表与打开的对话无关；已禁用的技能仍然可见。文件技能按解析后的文件路径去重，包括符号链接。连接器之外的技能支持持久化的账户调用开关，只有个人导入支持移除。偏好按技能名称跨来源生效，同时限制模型和用户调用，不修改文件，也不扩大工作区访问权限。导入一个 SKILL.md、.skill 或 ZIP 包，其中必须恰好包含一个技能定义。资源路径必须位于该目录内；重复路径、格式错误的 frontmatter 和超出大小限制的包将被拒绝。导入使用现有技能提供方注册表及调用控制。

自定义连接接受 Streamable HTTP MCP 地址和可选 bearer token；GitHub 还接受用于其官方远程地址的个人访问令牌。创建连接会先验证 MCP 发现，再保存。令牌仅可写入，并由凭据提供方按账户派生的键保存。即使对话仍持有旧工具目录，禁用或断开连接也会拒绝后续调用。

Gmail、Google 云端硬盘和 Google 日历使用维护中的 Google Workspace MCP 桥接及各服务的 Google OAuth 权限。为 `providers.google` 配置一个 OAuth 应用，提供 `authorizationUrl`、`tokenUrl`、`clientId` 和可选的 `clientSecretRef`。在该 Cloud 项目中启用所选 Google API，并注册准确的 `redirectUri`。授权在保存前验证 API 访问。Drive 包含文档、表格、幻灯片、表单及评论。为这些技能启用 Drive、Docs、Sheets、Slides 和 Forms API；评论使用 Drive API。Forms 复用现有 Drive 授权权限。表单创建和问题编辑遵循普通文档编辑的权限处理；其他原始 Google 写入仍须显式批准。发现的 MCP 工具决定可用操作；技能指令不会添加工具。

连接器详情从现有注册表列出已安装的技能定义：Drive 拥有六项 Google 文档及文件技能；Gmail、日历和 GitHub 各拥有对应技能。连接器技能按名称仅在连接器详情中显示一次，需要已启用且已授权的连接。单独的技能偏好不控制连接器技能。禁用调用后仍可在管理页面查看指令。禁用或断开连接会使技能发现缓存失效并移除挂载工具；执行器也会拒绝过期调用。断开连接会取消待处理授权，并等待正在执行的回调结束后删除连接及凭据。

GitHub 和 Microsoft 365 登录需要在 `providers.github` 和 `providers.microsoft365` 下配置应用，提供 `endpoint`、`authorizationUrl`、`tokenUrl`、`clientId`、非空 `scopes` 和可选的 `clientSecretRef`。MCP 地址必须接受委托访问令牌。授权使用绑定账户且有时限的 state 和 PKCE；回调在保存前验证所选 API 或 MCP 资源的访问权限。过期授权在对话步骤前通过串行凭据写入刷新。回调展示本地化完成页面，提示用户关闭浏览器窗口并返回 Aeven；失败授权会区分令牌交换、API 访问验证和连接保存，不会显示提供商响应；登录过期时会提示重新开始。

WhatsApp 和 Telegram 每个账户各自占一行连接器，每行拥有一个受监管的守护进程，其绑定的回环端口由操作系统分配。宿主启动该进程并在异常退出后按退避策略重启，保持其标准输入打开，因此宿主崩溃后不会遗留持有会话的进程；其工具挂载为 `mcp__account_<connector-id-prefix>__<tool>`。每个对话步骤开始前都会挂载所有连接器；无法连接的连接器会被记录并在该步骤中略过，下一步骤再次尝试，因此出问题的账户绝不会终止一个轮次。设置中扫描二维码即可关联 WhatsApp 号码；Telegram 账户则输入手机号、Telegram 发送的验证码，以及 Telegram 要求时的两步验证密码完成登录。手机扫描二维码后保存该号码；Telegram 授权后保存该账户，已在列表中的账户会被拒绝而不会重复添加。取消关联会在提供商侧结束会话并删除该连接器的数据目录。每个账户各自拥有进程与命名空间，因此一个对话可以访问多个账户而不会相互混淆。

Telegram 守护进程是 vendored 的 [`bstuff/telegram-mcp`](../../../native/telegram-mcp/README.zh.md) 服务，外加 Aeven 提供的入口，用于增加回环 MCP 端点与登录控制路由。部署方拥有一个已注册的 Telegram 应用，并将 `telegramApiIdRef` 与 `telegramApiHashRef` 指向凭据引用；宿主解析这些值后仅传入守护进程的环境，因此它们不会出现在工具 schema、模型请求或浏览器响应中。每个账户的会话字符串、身份缓存与下载内容都保存在该账户自己的目录中。用户可以用 Telegram 应用扫描二维码登录，也可以用手机号和验证码登录；若账户启用了两步验证，Telegram 随后会要求输入密码。同一用户的每个 Telegram 账户只有一个连接器 id，由该用户与 Telegram 用户 id 派生：重新登录已退出的账户会就地恢复，取消关联后重新登录也会得到相同的 id，因此已在使用该账户工具的对话中，工具名称保持不变。登录一个已登录的账户会作为重复而被拒绝。

读取 WhatsApp 或 Telegram 内容——消息文本、文件名、成员列表——对模型而言都是他人的数据。仅读取账户的工具直接执行；发送、编辑、删除、转发、回应、置顶、静音、标记已读、定时发送、正在输入提示、骰子、投票以及所有群组变更都会先征求用户批准。

管理员可在 web profile 的 `cordis.patch.yml` 中配置 Google；`clientSecretRef` 指向部署凭据提供方管理的凭据：

```yaml
- id: account-integrations
  config:
    redirectUri: http://127.0.0.1:3080/connectors/oauth/callback
    providers:
      google:
        authorizationUrl: https://accounts.google.com/o/oauth2/v2/auth
        tokenUrl: https://oauth2.googleapis.com/token
        clientId: YOUR_GOOGLE_CLIENT_ID
        clientSecretRef: YOUR_GOOGLE_CLIENT_SECRET_REFERENCE
```

| Field | Default | Meaning |
|---|---|---|
| `maxSkillBytes` | 10485760 | 解码后技能包的最大字节数 |
| `timeoutMs` | 60000 | OAuth、MCP 发现、守护进程控制及工具请求的时限 |
| `consentLifetimeMs` | 600000 | 授权或登录操作的最大持续时间 |
| `redirectUri` | `http://127.0.0.1:3080/connectors/oauth/callback` | 已注册的回调 URL |
| `providers` | `{}` | 部署所属的 OAuth 应用和可选 MCP 资源 |
| `maxEmailAccounts` | 20 | 一个账户可连接的邮箱数 |
| `maxWhatsAppAccounts` | 10 | 一个账户可关联的 WhatsApp 号码数 |
| `maxTelegramAccounts` | 10 | 一个账户可登录的 Telegram 账户数 |
| `whatsappBinaryPath` | 平台包 | WhatsApp 守护进程可执行文件 |
| `whatsappStartupTimeoutMs`、`whatsappStopGraceMs` | 15000、5000 | 绑定回环端口的时限，以及标准输入关闭后的退出时限 |
| `whatsappPairingPollMs` | 1500 | 读取二维码状态的间隔 |
| `whatsappRestartDelayMs`、`whatsappMaxRestartDelayMs` | 1000、60000 | 重启退避的上下限 |
| `telegramEntryPath` | vendored 包 | Telegram 守护进程入口 |
| `telegramApiIdRef`、`telegramApiHashRef` | `TELEGRAM_API_ID`、`TELEGRAM_API_HASH` | 持有已注册 Telegram 应用的凭据引用 |
| `telegramStartupTimeoutMs`、`telegramStopGraceMs` | 15000、5000 | 绑定回环端口的时限，以及标准输入关闭后的退出时限 |
| `telegramPairingPollMs` | 1500 | 读取登录状态的间隔 |
| `telegramRestartDelayMs`、`telegramMaxRestartDelayMs` | 1000、60000 | 重启退避的上下限 |

## Understand the implementation

<details>
<summary>实现内部机制</summary>

账户 domain 保存元数据和经过验证的技能资源；凭据提供方保存秘密。技能提供方按所属账户筛选每次查询。连接器 scope 属于此插件，并在其对话结束时释放；现有 MCP 客户端将发现的工具注册到所属 agent 的 scope。技能变化通过转发的注册表事件使浏览器斜杠菜单缓存失效。由于操作直接使用存储、身份、凭据、技能和工具注册表，因此不发布 invariant 伴随插件。

</details>

## Model Experience

### Personal skill catalog

#### What the model sees

[技能加载器](../../skill/tool-skill/README.zh.md)发布已启用且允许模型调用的个人技能，并按需加载其指令正文和资源目录。

#### Token effect

目录成本随启用的技能数量增长。加载的指令将其内容加入会话历史。

#### KV Cache effect

导入、替换及启用状态变更会改变下一次目录观测。已经记录的技能指令仍属于对话历史。

### Connector tools

#### What the model sees

[MCP 客户端](../../mcp/mcp-client/README.zh.md)以 mcp__account_<connector-id-prefix>__<tool> 名称发布所属账户已启用的工具。凭据不会进入工具 schema 或模型结果。

#### Token effect

启用的 MCP 服务器增加发现的工具 schema。调用增加其结果。此插件不添加单独的系统提示。

#### KV Cache effect

连接、禁用或断开服务器会改变下一步骤的工具目录，并可能改变可复用的请求前缀。

## Known Limitations and Deferred Work

- 提供方登录需要注册应用和用户授权；编译无法验证真实授权。Microsoft 365 还需要兼容的 MCP 服务器。
- 关联 WhatsApp 号码需要用户手机；登录 Telegram 需要该部署已注册的 Telegram 应用以及用户的手机号、验证码和两步验证密码。两条路径都不会在测试中登录真实账户；守护进程的登录处理通过替换 Telegram 客户端进行覆盖。
- Telegram 以用户自己的账户（用户会话，而非机器人）登录，因此适用 Telegram 的 API 条款，自动化批量操作可能使账户受限。
- Workspace 桥接提供所选 Google 服务，其可用工具可能与 ChatGPT 应用连接器不同。
- 这些页面不提供自定义 stdio 服务器或通用 MCP OAuth 发现。
- 为加载技能而写入磁盘的导入资源，在移除目录项后仍保留。

## Dev Note

不重新分发 Claude 应用二进制文件或其专有的文档技能包。
