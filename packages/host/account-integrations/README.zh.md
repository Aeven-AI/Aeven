---
description: "个人技能包和账户所属的远程 MCP 连接。"
kind: "package-reference"
---

# @aeven/host-account-integrations

[English](README.md) | 中文

## 概述

已登录用户可导入、查看、启用和移除自己的技能、连接远程 MCP 服务器、关联 WhatsApp 号码、登录 Telegram 账户、添加 Discord 服务器并连接 Slack 工作区。每项管理操作均从已认证请求确定所属账户。技能和连接器凭据在重启后保留；对话仅获得其所属账户的集成。

连接器写入审批提供针对同一账户和工具操作的会话授权。Google Workspace 原始调用还将授权范围限定到服务及资源方法路径。每次审批请求前都会检查账户所有者、连接状态和启用状态。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## Use this package

Web bundle 将此插件与[技能和连接器页面](../../client/ui-settings-integrations/README.zh.md)一起挂载。设置列出账户自己的技能：导入的包与已安装的技能。被发现的技能——代码仓库、部署默认预设，以及账户拥有的每个文件夹工作区——不会列出，因为它们始终可用，也没有账户级开关；连接器拥有的技能只出现在该连接器的详情中。列表与打开的对话无关，已禁用的技能仍然可见。每个列出的技能都有一个持久化的账户调用开关，移除它会删除已存储的包。偏好作用于该技能名称，同时限制模型和用户调用，不修改文件，也不扩大工作区访问权限。导入一个 SKILL.md、.skill 或 ZIP 包，其中必须恰好包含一个技能定义。资源路径必须位于该目录内；重复路径、格式错误的 frontmatter 和超出大小限制的包将被拒绝。导入使用现有技能提供方注册表及调用控制。

账户启用已安装的 `reverse-engineering` 技能时，该启用动作会在后台于 `$AVN_HOME/runtimes/reverse-engineering` 内准备 REA 与兼容的分析引擎，因此其后的首次对话请求已经拥有这些工具。初始化先询问宿主：`rea doctor` 认证通过的 Ghidra 与 JDK 就地使用，不下载任何内容；没有可用引擎的机器才会把 Ghidra 与 JDK 归档下载一次，存入按内容寻址的缓存供后续尝试复用。Ghidra 的发布归档不含 macOS 反编译器，因此在 macOS 上初始化会用它自带的源码构建一个，这需要 Xcode 命令行工具。任何请求都不会等待初始化，初始化失败也绝不会让请求失败：设置显示进度与失败详情，并提供显式重试；自动重试等待 `retryDelayMs`，随后按 agent 连接 REA 工具。`reverseEngineering` 配置选择版本、安装预算与重试延迟。引擎发现与下载需要网络。Ghidra 之外的专用引擎仍需另行准备。

自定义连接接受 Streamable HTTP MCP 地址和可选 bearer token；GitHub 还接受用于其官方远程地址的个人访问令牌。创建连接会先验证 MCP 发现，再保存。令牌仅可写入，并由凭据提供方按账户派生的键保存。即使对话仍持有旧工具目录，禁用或断开连接也会拒绝后续调用。

Gmail、Google 云端硬盘和 Google 日历使用维护中的 Google Workspace MCP 桥接及各服务的 Google OAuth 权限。OAuth 应用、其权限范围和所有授权都保存在 `apiUrl` 指定的 Aeven API 上；宿主不持有任何客户端密钥或刷新令牌。授权在保存前验证 API 访问。Drive 包含文档、表格、幻灯片、表单及评论。为这些技能启用 Drive、Docs、Sheets、Slides 和 Forms API；评论使用 Drive API。Forms 复用现有 Drive 授权权限。表单创建和问题编辑遵循普通文档编辑的权限处理；其他原始 Google 写入仍须显式批准。发现的 MCP 工具决定可用操作；技能指令不会添加工具。

连接器详情从现有注册表列出已安装的技能定义：Drive 拥有六项 Google 文档及文件技能；Gmail、日历和 GitHub 各拥有对应技能。连接器技能按名称仅在连接器详情中显示一次，需要已启用且已授权的连接。单独的技能偏好不控制连接器技能。禁用调用后仍可在管理页面查看指令。禁用或断开连接会使技能发现缓存失效并移除挂载工具；执行器也会拒绝过期调用。断开连接会取消待处理授权，并等待正在执行的回调结束后删除连接及凭据。

Google、Microsoft 和 GitHub 通过 Aeven API 的连接器代理登录，并以已登录用户自己的 Aeven 会话认证。API 使用绑定账户且有时限的 state 和 PKCE 发起授权，接收提供商的重定向，用应用密钥兑换授权码，并加密保存授权；其回调页面提示用户关闭窗口并返回 Aeven，失败时只说明失败的步骤，不显示提供商响应。读者返回后再次读取设置时，宿主获取访问令牌、验证对所选 API 或 MCP 资源的访问并保存连接器；验证失败时删除该授权。对话步骤前宿主向 API 请求当前访问令牌，由 API 负责刷新；被提供商撤销的授权会将连接器标记为需重新连接。Microsoft 365 在 Aeven API 上没有应用，显示为未配置。

WhatsApp 和 Telegram 每个账户各自占一行连接器，每行拥有一个受监管的守护进程，其绑定的回环端口由操作系统分配。宿主启动该进程并在异常退出后按退避策略重启，保持其标准输入打开，因此宿主崩溃后不会遗留持有会话的进程；其工具挂载为 `mcp__<provider>_<connector-id-prefix>__<tool>`。每个对话步骤开始前都会挂载所有连接器；无法连接的连接器会被记录并在该步骤中略过，下一步骤再次尝试，因此出问题的账户绝不会终止一个轮次。设置中扫描二维码即可关联 WhatsApp 号码；Telegram 账户则输入手机号、Telegram 发送的验证码，以及 Telegram 要求时的两步验证密码完成登录。手机扫描二维码后保存该号码；Telegram 授权后保存该账户，已在列表中的账户会被拒绝而不会重复添加。取消关联会在提供商侧结束会话并删除该连接器的数据目录。每个账户各自拥有进程与命名空间，因此一个对话可以访问多个账户而不会相互混淆。

Telegram 守护进程是 vendored 的 [`bstuff/telegram-mcp`](../../../native/telegram-mcp/README.zh.md) 服务，外加 Aeven 提供的入口，用于增加回环 MCP 端点与登录控制路由。部署方已注册的 Telegram 应用标识由已登录用户的会话从 Aeven API 获取，并缓存在凭据提供方中，因此已关联的账户可在启动时运行；宿主仅将其传入守护进程的环境，因此它们不会出现在工具 schema、模型请求或浏览器响应中。每个 MTProto 客户端都会出示这些标识，它们只标识应用，不授予任何账户权限。每个账户的会话字符串、身份缓存与下载内容都保存在该账户自己的目录中。用户可以用 Telegram 应用扫描二维码登录，也可以用手机号和验证码登录；若账户启用了两步验证，Telegram 随后会要求输入密码。同一用户的每个 Telegram 账户只有一个连接器 id，由该用户与 Telegram 用户 id 派生：重新登录已退出的账户会就地恢复，取消关联后重新登录也会得到相同的 id，因此已在使用该账户工具的对话中，工具名称保持不变。登录一个已登录的账户会作为重复而被拒绝。

Discord 每个服务器各占一行连接器。所有行都由同一个 Aeven Discord 应用及其机器人支撑，服务器 id 是区分它们的依据：工具按行挂载为 `mcp__<provider>_<connector-id-prefix>__<tool>`，每个服务器运行在自己的 stdio 子进程中，且任何工具都不接受服务器参数；每行可独立启用、禁用和移除。在设置中添加服务器会打开 Discord 的机器人授权页面；回调会兑换授权码、确认机器人已在服务器中、读取服务器名称、图标与安装者，然后保存该行。向已连接的服务器再次安装会刷新该行而不会重复添加；连接器 id 由账户与服务器 id 派生，因此重新安装后工具名称保持不变；`maxDiscordGuilds` 限制一个账户可连接的服务器数量。移除服务器会在 Discord 允许的情况下将 Aeven 机器人移出该服务器，然后删除该行；服务器行本身不保存凭据记录。

Discord 子进程即 [native/discord-mcp](../../../native/discord-mcp/README.zh.md) 服务：精选的十三项工具，用于读取频道、消息、主题、成员和服务器信息，以及发送、回复、回应、上传文件和创建主题；管理与审核工具——踢出、封禁、批量封禁、禁言、删除和清理消息、角色、频道与权限、邀请、审计日志、AutoMod 和服务器设置——仅在 `discordAdminTools` 开启时提供。Aeven Discord 应用的客户端密钥和机器人令牌保存在 Aeven API 上。安装授权通过 API 的连接器代理完成，并由其确认机器人已加入服务器；子进程以所有者的 Aeven 会话将每个 Discord 调用发送到 API 的 Discord 代理，代理仅对该所有者安装了机器人的服务器内的路径以机器人身份操作。所有者的会话轮换时，子进程以新会话重启。移除服务器时，只有在没有其他 Aeven 用户仍安装该机器人时，机器人才会退出该服务器。安装链接请求所提供的工具面所需的权限位域，`discordPermissions` 可替换该位域；Discord 的服务器级文本搜索仅限用户账户，因此 `search_messages` 在扫描预算内遍历消息并报告覆盖范围。

Slack 每个工作区各占一行连接器，而且与各代理提供方不同，它不需要 Aeven API 上的应用：Slack 的 PKCE 客户端是公开客户端，因此登录在本宿主上运行，部署所配置的唯一 Slack 值就是应用的公开客户端 id。`authorize('slack')` 绑定所配置的回环端口、返回供设置页面打开的授权 URL，并在浏览器带回授权码时完成登录：兑换只发送 `code_verifier`、不带客户端密钥，Slack 自身的令牌测试则给出该行记录的团队与账户。连接器 id 由账户与 team id 派生，因此重新连接后工具名称保持不变；`maxSlackWorkspaces` 限制行数；该行以存储的用户令牌作为 bearer，通过 Streamable HTTP 挂载 [Slack 的 MCP 服务器](https://docs.slack.dev/ai/slack-mcp-server/)。所请求的作用域是工作区界面——搜索公开与私有频道、文件与人员，读取频道、消息串、用户资料与频道成员，以及这些工具所需的写入——`slackDirectMessages` 另加私信搜索与历史，后者也必须注册在应用上。读取直接运行；名称读起来不像读取的调用先征求批准，并以读者身份而非机器人身份发布。`probeSlackToken` 最多每个 `slackVerifyIntervalMs` 就存储的令牌询问 Slack 一次，使被撤销的登录不再声称已连接；断开连接会在 Slack 侧撤销该令牌。

读取 WhatsApp、Telegram、Discord 或 Slack 内容——消息文本、文件名、成员列表——对模型而言都是他人的数据。仅读取账户的工具直接执行；发送、编辑、删除、转发、回应、置顶、静音、标记已读、定时发送、正在输入提示、骰子、投票以及所有群组变更都会先征求用户批准。在 Discord 中，发送、回复、回应、上传文件和创建主题需要批准，每项管理与审核调用都单独请求批准并说明具体变更。

Google、Microsoft、GitHub、Discord 和 Telegram 需要由其连接器代理持有应用凭据的 Aeven API：

```yaml
- id: account-integrations
  config:
    apiUrl: https://api.aeven.example
```

Slack 是唯一不需要在 Aeven API 上保存凭据的提供方：它的 PKCE 客户端是公开客户端，因此部署只持有一个公开的客户端 id，登录在宿主上运行。

### 配置 Slack 应用

在将要使用它的 Slack 工作区中创建应用——把下面的 manifest 粘贴到 **From a manifest**，或手工创建——然后启用 PKCE，并从 **Basic Information → App Credentials** 复制客户端 id。所注册的重定向必须与宿主绑定的端口一致，且连接器请求的每个用户作用域都必须注册在应用上：

```json
{
  "display_information": {
    "name": "Aeven"
  },
  "oauth_config": {
    "redirect_urls": [
      "http://127.0.0.1:12751/callback"
    ],
    "scopes": {
      "user": [
        "search:read.public",
        "search:read.private",
        "search:read.files",
        "search:read.users",
        "channels:read",
        "groups:read",
        "im:read",
        "mpim:read",
        "channels:history",
        "groups:history",
        "users:read",
        "files:read",
        "emoji:read",
        "chat:write",
        "reactions:read",
        "reactions:write",
        "files:write",
        "canvases:read",
        "canvases:write",
        "lists:read",
        "lists:write",
        "channels:write",
        "groups:write",
        "im:write",
        "mpim:write"
      ]
    },
    "pkce_enabled": true
  },
  "settings": {
    "org_deploy_enabled": false,
    "socket_mode_enabled": false,
    "token_rotation_enabled": false
  }
}
```

在创建之前，有两个性质值得了解。启用 PKCE 是单向设置：不经 Slack 支持，该应用无法回到机密客户端。Slack 只向已在 Marketplace 发布的应用或内部应用提供 MCP，因此必须由工作区管理员先批准该应用，工作区才能连接。

在提供连接器的 profile 中注册客户端 id 与回调端口：

```yaml
- id: account-integrations
  config:
    apiUrl: https://api.aeven.example
    slackClientId: 1234567890.1234567890
    slackCallbackPort: 12751
```

| Field | Default | Meaning |
|---|---|---|
| `maxSkillBytes` | 10485760 | 解码后技能包的最大字节数 |
| `timeoutMs` | 60000 | OAuth、MCP 发现、守护进程控制及工具请求的时限 |
| `consentLifetimeMs` | 600000 | 授权或登录操作的最大持续时间 |
| `apiUrl` | 无 | 由其连接器代理持有所有提供商凭据的 Aeven API 源；缺省时 Google、Microsoft、GitHub、Discord 和 Telegram 不可用 |
| `credentialRef` | `AEVEN_TOKEN` | 持有每个已登录用户 Aeven 访问令牌的凭据引用 |
| `maxEmailAccounts` | 20 | 一个账户可连接的邮箱数 |
| `maxWhatsAppAccounts` | 10 | 一个账户可关联的 WhatsApp 号码数 |
| `maxTelegramAccounts` | 10 | 一个账户可登录的 Telegram 账户数 |
| `whatsappBinaryPath` | 平台包 | WhatsApp 守护进程可执行文件 |
| `whatsappStartupTimeoutMs`、`whatsappStopGraceMs` | 15000、5000 | 绑定回环端口的时限，以及标准输入关闭后的退出时限 |
| `whatsappPairingPollMs` | 1500 | 读取二维码状态的间隔 |
| `whatsappRestartDelayMs`、`whatsappMaxRestartDelayMs` | 1000、60000 | 重启退避的上下限 |
| `telegramEntryPath` | vendored 包 | Telegram 守护进程入口 |
| `telegramStartupTimeoutMs`、`telegramStopGraceMs` | 15000、5000 | 绑定回环端口的时限，以及标准输入关闭后的退出时限 |
| `telegramPairingPollMs` | 1500 | 读取登录状态的间隔 |
| `telegramRestartDelayMs`、`telegramMaxRestartDelayMs` | 1000、60000 | 重启退避的上下限 |
| `maxDiscordGuilds` | 25 | 一个账户可连接的 Discord 服务器数量 |
| `discordEntryPath` | vendored 包 | Discord 连接器服务入口 |
| `discordPermissions` | 精选工具面位域 | 安装链接请求的权限位域 |
| `discordAdminTools` | false | 提供管理与审核工具，并请求其所需权限 |
| `discordVerifyIntervalMs` | 300000 | 已验证的服务器成员身份在被再次询问前可信的时长 |
| `maxSlackWorkspaces` | 10 | 一个账户可连接的 Slack 工作区数量 |
| `slackClientId` | 无 | 部署的 Slack 应用客户端 id，它是公开的；缺失则 Slack 不可用 |
| `slackCallbackPort` | 12751 | Slack 应用注册为 `http://127.0.0.1:<port>/callback` 的回环端口 |
| `slackDirectMessages` | false | 另外请求私信搜索与历史，后者也必须注册在应用上 |
| `slackVerifyIntervalMs` | 300000 | 有效的 Slack 令牌在被再次询问前可信的时长 |

Microsoft 提供五个独立启用的连接器：Outlook、Outlook 日历、OneDrive、SharePoint 和 Teams。维护中的 Graph 桥接进程从代理获取短期令牌，并仅提供各提供方的明确工具列表。桥接进程的登录及账户管理工具不会进入 harness 工具目录。读取直接运行；所有提供的 Microsoft 写入操作都按实际工具标识请求批准，包括被 MCP 桥接缩短的名称。仅在 Graph 账户身份及一次服务读取验证成功后保存授权。连接行保存账户及租户元数据，刷新令牌保留在 API 上。

Node API 需要一个支持工作及个人账户并注册了 Web 回调的应用，其凭据通过 `MICROSOFT_CONNECTOR_CLIENT_ID` 和 `MICROSOFT_CONNECTOR_CLIENT_SECRET` 配置。SharePoint 和 Teams 仅支持工作账户授权。管理员拒绝授权时，Settings 显示该应用针对提供方的批准链接；批准后用户重新登录。过期或已撤销的授权需要重新连接。

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

[MCP 客户端](../../mcp/mcp-client/README.zh.md)以 mcp__<provider>_<connector-id-prefix>__<tool> 名称发布所属账户已启用的工具。凭据不会进入工具 schema 或模型结果。

#### Token effect

启用的 MCP 服务器增加发现的工具 schema。调用增加其结果。此插件不添加单独的系统提示。

#### KV Cache effect

连接、禁用或断开服务器会改变下一步骤的工具目录，并可能改变可复用的请求前缀。

## Known Limitations and Deferred Work

- 提供方登录需要 Aeven API 上已注册的应用和用户授权；编译无法验证真实授权。Microsoft 工作租户可能需要管理员同意及发布者验证。
- 经代理的连接器以所有者的 Aeven 会话运行：所有者在本宿主上没有有效会话时运行的对话步骤，不包含 Google、Microsoft、GitHub 和 Discord 工具。
- 关联 WhatsApp 号码需要用户手机；登录 Telegram 需要该部署已注册的 Telegram 应用以及用户的手机号、验证码和两步验证密码。两条路径都不会在测试中登录真实账户；守护进程的登录处理通过替换 Telegram 客户端进行覆盖。
- Telegram 以用户自己的账户（用户会话，而非机器人）登录，因此适用 Telegram 的 API 条款，自动化批量操作可能使账户受限。
- Workspace 桥接提供所选 Google 服务，其可用工具可能与 ChatGPT 应用连接器不同。
- 这些页面不提供自定义 stdio 服务器或通用 MCP OAuth 发现。
- 添加 Discord 服务器需要 Aeven API 上的 Aeven Discord 应用，在 Discord 开发者门户中启用消息内容与服务器成员特权意图，并注册 API 的回调地址；测试不会对 Discord 进行真实安装。
- 只有当对话读取时才会获取 Discord 消息；用于接收新消息与提及的 Gateway 监听器尚未实现。
- Discord 的服务器级文本搜索仅限用户账户，因此 `search_messages` 仅覆盖其扫描窗口并会说明覆盖范围。
- 连接 Slack 工作区需要一个启用 PKCE 并注册 `http://127.0.0.1:<slackCallbackPort>/callback` 的 Slack 应用；Slack 只允许已在 Marketplace 发布的应用或内部应用使用 MCP，且工作区管理员可以拒绝该集成，因此首次连接可能需要管理员批准。没有任何测试会连接 Slack。
- 在 Slack 应用上启用 PKCE 是单向操作，其刷新令牌在 30 天未使用后过期，因此被搁置的工作区需要重新连接。
- 私信搜索与历史需要在授权时启用 `slackDirectMessages`，且必须注册在应用上；未启用时连接的工作区需要重新连接才能获得。
- 为加载技能而写入磁盘的导入资源，在移除目录项后仍保留。

<a id="dev-note"></a>
### 开发备注

不重新分发 Claude 应用二进制文件或其专有的文档技能包。
