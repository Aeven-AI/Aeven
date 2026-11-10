---
description: "面向模型的 offer_desktop 工具：Aeven Web 如何挂载它、它在读者窗口中打开什么，以及模型看到什么。"
kind: "package-reference"
---

# @aeven/tool-desktop-handoff

[English](README.md) | 中文

## 概述

`@aeven/tool-desktop-handoff` 让模型在请求需要读者自己的电脑、而 Host 无法访问它时（例如在 Aeven Web 上）推荐 Aeven 桌面应用。它注册一个工具 `offer_desktop`，调用会变成一个 `desktop-handoff/offer` waterfall，由显示该会话的客户端应答：打开 `@aeven/client-ui-desktop-handoff` 的“在 Aeven 桌面版中使用”对话框。对话框可以在桌面应用中继续同一个对话，或提供下载。该工具不读取也不更改任何内容。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

`aeven` 预设把这一行声明为禁用，由 `avn-hosted-app` 包启用：桌面 Host 本身就能访问读者的电脑，在那里推荐只会是干扰。

### 配置

该字段可选；无效值会使插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `answerTimeoutMs` | `10000` | 显示该会话的窗口打开对话框的时限（毫秒），声明为工具的 `timeoutMs`；超过后该推荐视为无人应答。 |

```yaml
- id: tool-desktop-handoff
  name: '@aeven/tool-desktop-handoff'
```

<a id="understand-the-implementation"></a>
## 理解实现

工具以调用它的 agent 为作用域分发 `desktop-handoff/offer`，携带模型给出的 `reason`（`computer`、`files`、`terminal`、`device` 或 `models`）以及受 `answerTimeoutMs` 限制的信号。`@aeven/api-remotes` 把它转发给显示该会话的窗口，窗口用对应原因的说明打开对话框并应答 `shown`；显示其他会话的窗口调用 `next()`，最终的回退应答 `no-window`。由于推荐以实时事件传递，之后从历史加载的对话不会再次打开对话框。

## 模型体验

### 工具模式

#### 模型看到什么

模型看到生成的 [`offer_desktop` 模式](../../../docs/tool-catalog.zh.md#aeventool-desktop-handoff)。

##### 已显示结果

```markdown
A dialog in the user's window now offers to continue this conversation in Aeven Desktop, or to download it. Tell the user in one sentence what the desktop app would do for this request.
```

##### 无窗口结果

```markdown
No window is showing this conversation, so nothing opened. Tell the user that the Aeven desktop app can do this on their computer.
```

#### Token 影响

工具可见期间每次请求的模式固定；一次调用追加一段简短结果。

#### KV Cache 影响

可见工具集不变时前缀稳定；结果追加在后。

## 已知限制与延后工作

- **对话框中没有桌面路由** —— 读者有桌面设备在线时，Aeven Web 上的对话本来就在那里运行；推荐只出现在 Aeven Cloud 中运行的轮次里，对话框还不会列出在线的桌面设备。
- **由模型决定何时推荐** —— Host 不会检测需要读者电脑的请求；工具描述要求模型在原本会说做不到的地方调用它。
- **无不变量伴随包** —— 不发布运行时不变量伴随包，因为该工具自身不持有状态：一次调用分发有作用域的 `desktop-handoff/offer` waterfall，`renderDesktopHandoffResult` 是客户端插件给出的单个应答的纯函数，没有第二个可比较的观察。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
