---
description: "Host 与 Client 会话控制：创建、恢复、提示、跟随历史并投影实时会话状态。"
kind: "package-reference"
---
# Session Controller

[English](README.md) | 中文

## 概述

`@aeven/api-session-controller` 拥有 Host 的 `ctx.sessionController` 服务，以及生成的 Client `session`、`skills` 和 `fileReferences` Remote namespace。它提供 Session 生命周期与历史、Host generation 模型目录、工作区路径打开、用户可调用 skill 发现，以及面向 Agent 的文件引用 adapter。当 Client 需要按 Session 寻址的操作时，请通过 API Gateway 使用它。

## 目录

- [使用本包](#use-this-package)
- [配置](#configuration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

历史页与 follow opening snapshot 携带带判别字段的 `SessionHistoryRecord`。两个分支都使用 `{ type, event }`：`type: 'event'` 携带一个原始 `SessionWireEvent`，`type: 'chunks'` 则携带一个由连续且属于同一 block 的 `assistant/chunk` delta 组成的无损 `ChunkRowEvent`。两种内部值都公开 `type`、`seq`、`time` 与 `data`，因此 Client 无需逐 record 转换，就能把每条已接受 record 保留为一个 `SessionEventLikeEntry`。packed event 的 `seq` 与 `time` 表示首成员，`data` 保留 fragment 与 timestamp-gap 数组。实时 follow frame 继续携带单个 `event` record。工具参数、结果内容、失败信息和 `tool/result.data.meta` 原样通过；controller 不解析 Tool definition、不运行 presenter，也不附加 UI 数据。

每个 endpoint 都声明自己的激活策略。列表、搜索、附件、历史页、日志跟随、skill 发现和工作区路径打开可以在不激活 Agent 的情况下检查 persistence；`canOpenWorkspacePath()` 无需指定 Session 即可报告原生打开能力。queue 变更与取消要求 live 状态；模型、重命名、书签、prompt 和文件引用操作可以解析或恢复普通 Session。只有 create 与 fork 会直接创建新 Agent。skill 目录则优先使用已有 live Agent，否则使用所记录 preset 的常驻 scope，因此列表查询绝不会启动 Agent。

经过身份验证的 `/api/file` 路由通过已组合的文件系统提供者提供绝对路径文件。对于无扩展名的栅格文件，包括持久化的附件对象，它会识别 PNG、JPEG、WebP 和 GIF 字节，使 Markdown 图片能够直接引用已存储的路径。

Client adapter 提供 `SessionEventStream`，即绑定到一个普通 Session 或 direct subagent address 的 Gateway `RemoteJournalStream`。它在读取首个 page 前打开 follow，只发布连续的 `replace`、`prepend` 和 `append` 变更，并通过 tail page 修复重连或 seq 缺口。向后分页有两个动词：`loadOlder()` 拉一页 50 条 message，而 `loadThrough(seq)`——轮次跳转加载器——无论目标在多远之前，都只用一个往返安装一个锚定在目标 seq 上的 200 条 message 窗口；重复调用会加入进行中的那一趟并下调共享目标，已安装的窗口覆盖该目标时该趟即结束；忙碌状态复用同一个 `loadingOlder` 快照位。普通 record 覆盖 `[event.seq, event.seq]`，packed row 覆盖 `[event.seq, event.seq + memberCount - 1]`。业务、persistence 或无法恢复的连续性错误会终止 stream，只有物理载体断开才触发自动恢复。`SessionControlStream` 是 Gateway `RemoteSnapshotStream`；每代都以完整的进程本地 baseline 开始，因此重连会替换 queue、jobs 和 projection 状态，而不会把瞬态值当作 durable event。

Session 对象还承载本地提交回显：`session.beginSubmission` 在调用方序列化与 prompt 之前，同步把一条回显写入 `SessionSnapshot.pendingSubmissions`，会话 UI 因此能在点击提交的当帧显示消息。Session 根据当前运行状态与请求的投递模式推导每条回显的 `transcript`、`queued` 或 `steering` 位置，并在序列化期间保留该位置。prompt 的 `requestId` 是关联标识：Host 把它回显为 durable user source 的 `rpcId`，queue occurrence 也把它投影为 `SessionQueuedItem.rpcId`。回显在观察到其 durable event 或 queue occurrence 后延迟一个动画帧退休，该延迟保证替代内容就绪前回显仍可渲染；带标识的 prompt 失败或被放弃时立即退休，销毁时按 failed 退休；每次退休恰好触发一次注册的 `onRetire` 回调。回显只存在于 Client 内存；刷新与重连只从 durable event 重建会话。

-----

<a id="configuration"></a>
## 配置

| 字段 | 默认值 | 含义 |
|---|---:|---|
| `coldBlankProbeMaxBytes` | `1,024` | 可进行空白状态验证的冷 Session 工件最大物理大小；`0` 禁用探测 |
| `nativeOpen` | 平台探测 | 是否能把 Session 工作区路径交给原生桌面打开器 |

`modelCatalog()` 在每次调用时都从实时 LLM 注册表构建，因此某条路由自启动以来增长的模型列表——例如挂载之后才完成的 `catalogRefresh`——无需重启即可体现。提供方，以及每个提供方内部的模型，都按浏览器显示的标签排序，并以模型 id 作为并列时的次序依据，使同名条目在多次调用之间保持稳定顺序。比较是数字感知的，因此 `GLM 5.2` 先于 `GLM 5.3`，`GLM 5.3` 先于 `GLM 5.10`。提供方失败保持注册表顺序：该列表是诊断通道，而非供人扫视查找模型的列表。排序位于此处而非路由自身的目录中，后者对一切参与派发的用途保持配置顺序。

生成的[配置目录](../../../docs/config-catalog.zh.md#aevenapi-session-controller)是所有受支持字段及其 JSDoc 的完整来源。

-----

<a id="model-experience"></a>
## 模型体验

无：本包是 Session API 与传输的归属者；它所调用的 Agent 命令拥有每一项模型可见效果，包括记录在已接纳用户消息上的资料名字。

#### KV Cache 影响

无；没有任何 prompt 输入源自这里。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- `list()` 从持久化投影缓存提供冷行，并在每次调用中最多从日志重新折叠 20 条无标题的行。因此，缓存完全不可读的 home（旧版本构建面对新版本写下的记录）在每次列表时只恢复一部分标题，而不是一次全部恢复；不过每次重新折叠都会把该行写回，所以反复列表会收敛。
- Control baseline 表示进程本地状态，因此 Host 重启后无法重建 jobs。
- follow 恢复失败会对调用方可见，而不会无限重试。
- 文件引用补全使用共享 Agent lookup，因此可能恢复冷 Session；`skills/list` 目录是不激活 Agent 的 skill 元数据读取路径。


<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。每个分页与帧都会对照其指向的持久 Session 校验。
