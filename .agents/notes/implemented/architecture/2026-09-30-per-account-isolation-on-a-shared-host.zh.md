# Agent Note: 共享 Host 上的按账户隔离

Status: implemented

## Problem

一个 Host 服务同一 Aeven home 的所有客户端：`avn web` 上的浏览器，以及桌面外壳——后者会接管已在服务其 home 的 Host，而不是再启动第二个写入者。这些客户端可能登录不同的 Aeven 账户，而 Host 把属于个人的状态放在 Host 级的共享位置。调用方的 Aeven 访问令牌存放在每个凭据引用一个的内存槽中，因此最后发出请求的客户端决定了所有模型请求的 bearer，一个账户的轮次消耗了另一个账户的额度。会话记录了 `owner`，但列表、读取、流和命令都不检查它，因此每个已登录客户端都能列出、打开、跟随并驱动其他账户的会话，并看到它们的实时活动。工作区、会话控制流、转发的 Host 事件、后台任务、子代理、终端、设备、动态 Cordis 插件、会话引用以及 MemOS Viewer 也以同样方式跨账户暴露状态。

## Decision

属于个人的状态归拥有它的已登录账户所有。可达性处处由同一条规则决定：`@aeven/identity-user` 中的 `IdentityUsers.mayAccess(owner, caller)`。未挂载身份授权方时任何调用方都可访问，单用户 harness 行为不变。挂载后只有所有者可访问，未记录所有者的状态对任何已登录调用方都不可达。其他账户的状态与不存在的状态给出完全相同的回答（`session/not-found`、`workspace/not-found`、空列表），调用方因此无法探测哪些标识存在。

### 每种传输上的调用方身份

HTTP 请求已运行在 `runAsCaller` 之内。WebSocket 流则不然：帧在任何请求之外到达，因此在 `follow`、`control` 和终端流中 `actingUser()` 为 undefined。`RemoteStreamMuxServer` 现在通过 `IdentityUsers.runAs(user, work)`，以升级请求认证的用户运行每个流的分发。按调用方过滤的流在打开时捕获调用方。

### 模型凭据

`CredentialProvider.setSession(ref, user, value)` 按账户存放会话凭据，`resolve(ref, user?)` 与 `describe(ref, user?)` 只看到该账户的会话值；不指定用户的调用永远看不到会话值。连接层以调用方的用户 id 发布每个被接纳的 bearer。`llm-aeven` 为请求所属会话（`GenerateOptions.sessionId`）的所有者解析 bearer，否则回退到当前调用方；为此 `DeepSeekAdapterOptions.resolveApiKey(connection, request)` 现在接收请求。模型页只为提问的账户描述 Aeven 路由。

### 会话

`ApiSessionAgentController` 在其唯一的解析器中检查所有权：在恢复冷会话之前检查一次，对解析出的 Agent 再检查一次。这覆盖了每个会话命令，以及 Typert 的 `agent`、`session` 和 agent 上下文查找——其他控制器的 `agent: Agent` 参数都经由它们。列表、搜索、历史 `page` 与 `follow`、分叉、附件与文件读取、队列编辑、取消、`inspect`、技能目录，以及 `create` 的显式 id 接管都检查同一个头部。控制流只把队列、任务与投影帧投递给调用方拥有该会话的流。

### 工作区

工作区记录带有 `owner`，即注册它的账户；内置工作区属于产品，所有账户都能看到。按路径的身份是 `(owner, path)`：另一个账户注册同一目录会得到自己的工作区，会话按 cwd 只加入本账户的工作区。在工作区带有所有者之前写入的记录，以其全部会话共同所属的那个账户作为所有者，因此现有工作区无需数据迁移即保有所有者。工作区列表、推送流和每个变更操作只触及调用方的工作区，并且在其中（包括内置工作区）只列出调用方的会话。

### 转发的 Host 事件

API 转发给客户端的每个通知都在 `packages/api/remotes` 中分类：关于单个会话的事件（`api-session/*`、`agent-preset/selected`、`cordis/request-run`、`cordis/inspect-query`、`cordis/dynamic-package`、`cordis/dynamic-retract`）携带含该会话所有者的 `RemoteEventAudience`，会话离开内存后所有者仍被记住；Host 级事件不携带。Gateway 只把带受众的事件投递给其用户可访问该所有者的客户端，并且只把每个作用域 waterfall（审批、用户提问、位置、浏览器自动化）投递给该 Agent 会话所有者的客户端。为此 `cordis/dynamic-package` 与 `cordis/dynamic-retract` 通过 `agentId` 标明其会话。

### 其他会话作用域的接口

任务（列表、跟随、终止、清除）、子代理（列表、提示、中断）、终端（列表、保留）、设备（打开、关闭，以及设备状态中的会话）、消息反馈、动态 Cordis 插件（清单、调用、请求决议）和会话引用（候选与被引用读取，限于目标会话的账户）都检查其所指会话的所有者。每个账户的记忆是 `accounts/<account>/memory` 下各自的 MemOS 数据库（[按账户划分的记忆数据库](2026-10-07-per-account-memory-databases.zh.md)），通过本就按所有者划分的记忆管理器访问；无需登录即提供所有账户记忆的 MemOS Viewer 已被移除。

### 按设计共享

机器与 Host 的配置保持共享：磁盘上的文件（`/api/file`、工作区文件、目录选择器）、`settings.yaml`、已存储的提供方 API 密钥、代理预设、插件、语音选择以及设备列表。它们描述的是这套安装而非某个人，Host 上每个已登录账户都能读取和修改。

## Alternatives considered

**每个账户一个 Host。** 同一 home 上的第二个 Host 是会话日志与工作区文档的第二个写入者，且没有跨进程锁，二者会相互覆盖。每个账户使用独立 home 能隔离状态，但同一个人在两台设备上会有两份历史，桌面外壳也不再共享浏览器的工作区，而这正是用户期望的行为。

**让桌面外壳使用私有开发 home。** 曾尝试并撤回：它掩盖而非修复了泄漏，任何访问同一 Host 的第二个账户仍能看到一切。

**只在客户端过滤。** 无法信任客户端丢弃已收到的数据；强制执行应位于 Host 应答之处。

**通过写入所有者来迁移现有工作区记录。** 这会改写用户数据且需要停止 Host；从会话推导无所有者记录的所有者不改动文件，结果相同。

**让无所有者的状态对所有人可见。** 登录前或由 webhook 创建的会话不记录所有者；把它们展示给每个账户，恰恰会为无人能认领的状态重新打开泄漏。

## Consequences

两个账户可以共享一个 Host 和一个 home，各自只看到自己的会话、工作区、提示与实时活动，并各自为自己的模型用量付费。同一账户在浏览器与桌面外壳中看到相同的数据。未记录所有者的会话对每个已登录账户都不可见；登录前创建的会话仍在磁盘上，但不再出现在列表中。会话分属多个账户的无所有者工作区在有人重新注册该目录之前不可见。不属于任何会话的后台任务仍列给每个账户的会话，Host 配置仍可由每个已登录账户修改；在产品把安装设置与个人设置分开之前，这两点都是有意为之。
