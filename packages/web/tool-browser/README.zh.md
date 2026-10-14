---
description: "面向模型的 preview_* 浏览器工具与第一步页面上下文：部署如何挂载它们、限定其等待，以及模型看到的内容。"
kind: "package-reference"
---

# @aeven/tool-browser

[English](README.md) | 中文

## 概述

`@aeven/tool-browser` 让模型读取并操作用户在会话旁看到的浏览器。它注册十四个 `preview_*` 工具，并在每轮的第一步把当前打开的页面作为一条记录在日志中的插件消息加入请求。插件本身不执行任何浏览器操作：每次调用都是一个 `browser/automation` waterfall，由持有该会话浏览器的 Client 应答；`preview_status` 例外，它同时报告 Host 运行的 Chromium。对该 waterfall 的每次等待都有上限，因此轮次永远不会等待一个没有任何已连接 Client 持有的浏览器。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在其 Client 能够承载浏览器的代理组合中挂载本插件，例如 `@aeven/client-ui-sidebar-browser` 的右侧边栏浏览器。随附的 `cordis`、`standard` 与 `ptc` 预设都会挂载它。

`preview_snapshot` 接受 `mode: dom`（默认）或 `mode: ax`。无障碍模式读取 Chromium 的无障碍树，包括 shadow DOM，并返回 `snapshotId`、带索引的 `nodes` 和 `truncated`。节点采用桌面元素字段 `index`、`token`、`role`、`title`、`value` 和 `editable`。将返回的令牌传给 `preview_click` 或 `preview_type`，代替选择器。令牌在下一次观察或浏览器操作时过期；导航后以及目标已分离、隐藏或禁用时会拒绝操作。操作后重新观察；框架内的无障碍目标不属于本阶段。

`preview_screenshot` 在 `actionTimeoutMs` 内将可见视口捕获为 JPEG，并把它存为工具结果中的持久图像附件。截图经普通图像结果路径进入会话日志和模型历史；此工具需要附件存储。

### 配置

两个字段均为可选；无效值会使插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `statusTimeoutMs` | `2000` | 每轮第一步等待当前页面的毫秒数，也是 `preview_status` 等待 Client 的毫秒数。超时后，本步不带浏览器上下文继续，状态报告中不含页面。 |
| `actionTimeoutMs` | `60000` | 每个 `preview_*` 调用等待的毫秒数，声明为该工具的 `timeoutMs`。由 `@aeven/tool-call-timeout-policy` 执行，模型收到 `TOOL_TIMEOUT`。 |

```yaml
- id: tool-browser
  name: '@aeven/tool-browser'
  config:
    statusTimeoutMs: 2000
    actionTimeoutMs: 60000
```

<a id="understand-the-implementation"></a>
## 理解实现

在 Web 组合中，`@aeven/api-remotes` 把 `browser/automation` 转发给 Typert 网关，网关把它投递给每个已连接的 Client，并且只有在每个投递都得到应答后才结算。挂起的转发 waterfall 没有截止时间，因为审批和用户提问必须送达稍后连接的 Client。因此插件自行限定等待：每次查询都在与轮次或调用 signal 合并的 `deadline` 下运行，把有界 signal 放入请求以便网关取消挂起的事件，并让 waterfall 与该 signal 竞速，因为监听器没有义务遵守它。第一步中未获应答的查询以 debug 级别记录；监听器失败以 warning 记录。[有界的浏览器状态查询](../../../.agents/notes/implemented/bug-fix/2026-09-24-bounded-browser-status-lookup.zh.md) Agent Note 记录了这一决定。

`preview_status` 无需页面即可应答。它把 Client 的应答与 `@aeven/browser-chromium` 的 `browserChromium` 服务状态组合起来 —— 通过 `ctx.get` 读取，因此未挂载 Host 浏览器的组合依然能够应答 —— 并报告该会话可以驱动的每个界面。需要页面的调用以 `BROWSER_UNAVAILABLE` 失败，并附带打开浏览器、或询问 `preview_status` 该会话有哪些界面的指示；没有调用方代理的调用以 `BROWSER_NO_AGENT` 失败。

## Model Experience

### 第一步浏览器上下文

#### What the model sees

在一轮的第一步，当浏览器应答的页面地址不是 `about:blank` 时，插件追加一条插件用户消息，写明页面标题和地址，其后是固定的说明。浏览器未在 `statusTimeoutMs` 内应答或页面为空白时，不添加任何内容。

##### 浏览器上下文消息

```markdown
The user has the in-app browser open beside this chat, showing: <title> — <url>

This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.
When this browser is selected, stay in it for the task. Use external Chrome/CDP only when this browser cannot perform the required action; never switch merely because an interaction failed.
Use preview_sequence for known consecutive actions; it runs locally in order and waits for specified elements without another model request between actions. Use preview_upload to attach files directly; never use clipboard tricks, a local HTTP server, or a native picker for a supported upload.
For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.
A page served from this machine (localhost or 127.0.0.1) is an application under development: verify it first in the browser the user can see — this pane, or the Chromium preview_status reports. Use the headless browser tools for it only when neither is available, and say that the check ran in a headless copy.
Correct an actionable error in this browser. If this browser needs authentication, ask the user to sign in here; never type credentials or switch browsers to bypass sign-in. Prefer preview_snapshot and focused actions over writing JavaScript for ordinary clicks or text entry.
```

#### Token effect

页面打开时每轮一次，约 400 个 token 加上标题和地址；没有打开页面或查询超时时为零。

#### KV Cache effect

仅追加：该消息在轮次开始时作为 `user/message` 记录，因此之前的请求 token 保持不变。

### 状态报告

#### What the model sees

`preview_status` 以一个 JSON 对象应答，并且不会因浏览器缺失而失败。`sessionTab` 是会话旁的浏览器当前显示的页面，或为 null。`hostBrowser` 是本 Host 运行的 Chromium —— 其调试端点、是否已有浏览器在该端点应答、是否找到了可执行文件，以及驱动它的工具名前缀 —— 当组合未挂载任何 Host 浏览器时为 null。当本会话注册的工具中没有任何一个带有该前缀时，`hostBrowser.toolsUnavailable` 依据 MCP 服务器的 `mcp/servers` 报告（其状态、最近一次错误以及 `tool_search` 重启查询）说明原因，`nextStep` 也会说明这些工具未在服务，而不是让模型去调用它们。`nextStep` 指明应当驱动什么：优先会话旁的页面，其次是 Host 的 Chromium，两者皆无时说明需要向用户请求什么；已打开的侧边栏浏览器保持选定，否则优先使用 Host 的可见 Chromium，再考虑无头浏览器。被 `web_fetch` 拒绝的页面正是这份报告存在的理由：会话旁的浏览器此时不可用，而 Host 的 Chromium 仍然可达。

#### Token effect

约 110 个 token，每次调用一次，而非每个请求一次。

#### KV Cache effect

无：工具结果追加在工具调用结束上一请求的位置。

### 工具 schema

#### What the model sees

模型看到生成的 [`preview_*` schema](../../../docs/tool-catalog.zh.md#aeventool-browser)。等待预算是部署设置，不是模型参数。

#### Token effect

工具可见时每个请求固定。

#### KV Cache effect

在可见工具集不变时前缀稳定。

## Known Limitations and Deferred Work

- **在 `statusTimeoutMs` 之后才应答的 Client 在该轮被忽略** —— 模型直到下一轮第一步才得知当前打开的页面。
- **没有已连接的 Client 时，每个新轮次都要等待 `statusTimeoutMs`** —— 网关无法告知插件没有 Client 连接，因此查询会在第一步之前等满其截止时间。
- **没有任何插件报告过的浏览器界面仍然不可见** —— 该报告只列出会话旁的页面与 Host 的 Chromium，因此组合挂载的其他自动化后端，只有在某个插件报告它之后才会被告知模型。
- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包自己的 spec 已经逐一验证了它拥有的关系：针对桩 waterfall 的第一步查询、`statusTimeoutMs` 与 `actionTimeoutMs` 之下的有界等待，以及状态报告中的界面选择。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
