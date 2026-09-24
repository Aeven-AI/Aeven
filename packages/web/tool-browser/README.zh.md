---
description: "面向模型的 preview_* 浏览器工具与第一步页面上下文：部署如何挂载它们、限定其等待，以及模型看到的内容。"
kind: "package-reference"
---

# @aeven/tool-browser

[English](README.md) | 中文

## 概要

`@aeven/tool-browser` 让模型读取并操作用户在会话旁看到的浏览器。它注册八个 `preview_*` 工具，并在每轮的第一步把当前打开的页面作为一条记录在日志中的插件消息加入请求。插件本身不执行任何浏览器操作：每次调用都是一个 `browser/automation` waterfall，由持有该会话浏览器的 Client 应答。对该 waterfall 的每次等待都有上限，因此轮次永远不会等待一个没有任何已连接 Client 持有的浏览器。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在其 Client 能够承载浏览器的代理组合中挂载本插件，例如 `@aeven/client-ui-sidebar-browser` 的右侧边栏浏览器。随附的 `cordis`、`standard` 与 `ptc` 预设都会挂载它。

### 配置

两个字段均为可选；无效值会使插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `statusTimeoutMs` | `2000` | 每轮第一步等待当前页面的毫秒数。超时后，本步不带浏览器上下文继续。 |
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

在 Web 组合中，`@aeven/api-remotes` 把 `browser/automation` 转发给 Typert 网关，网关把它投递给每个已连接的 Client，并且只有在每个投递都得到应答后才结算。挂起的转发 waterfall 没有截止时间，因为审批和用户提问必须送达稍后连接的 Client。因此插件自行限定等待：第一步查询在与本轮 signal 合并的 `deadline` 下运行，把有界 signal 放入请求以便网关取消挂起的事件，并让 waterfall 与该 signal 竞速，因为监听器没有义务遵守它。未获应答的查询以 debug 级别记录；监听器失败以 warning 记录。[有界的浏览器状态查询](../../../.agents/notes/implemented/bug-fix/2026-09-24-bounded-browser-status-lookup.zh.md) Agent Note 记录了这一决定。

没有 `browser/automation` 监听器时，`preview_*` 调用以 `BROWSER_UNAVAILABLE` 失败，并附带打开浏览器的指示；没有调用方代理的调用以 `BROWSER_NO_AGENT` 失败。

## Model Experience

### 第一步浏览器上下文

#### What the model sees

在一轮的第一步，当浏览器应答的页面地址不是 `about:blank` 时，插件追加一条插件用户消息，写明页面标题和地址，其后是固定的说明。浏览器未在 `statusTimeoutMs` 内应答或页面为空白时，不添加任何内容。

##### 浏览器上下文消息

```markdown
The user has the in-app browser open beside this chat, showing: <title> — <url>

This browser is the collaborative browser shared with the user. Prefer the preview_* tools for browser navigation, inspection, and interaction on it.
For browser work, first call preview_status. Then use preview_navigate, preview_snapshot, and the focused interaction tools. Prefer snapshot-provided selectors over coordinates.
Do not switch to Chrome, computer use, or standalone browser automation merely because a first call fails. A failed preview tool call should be inspected and retried with corrected arguments when the error is actionable.
```

#### Token effect

页面打开时每轮一次，约 110 个 token 加上标题和地址；没有打开页面或查询超时时为零。

#### KV Cache effect

仅追加：该消息在轮次开始时作为 `user/message` 记录，因此之前的请求 token 保持不变。

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

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
