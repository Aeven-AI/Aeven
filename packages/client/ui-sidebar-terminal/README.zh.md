---
description: "右侧栏的 Terminal 内容种类：每个标签页一个交互式 shell，由 xterm.js 渲染并跟随应用主题重新着色。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-terminal

[English](README.md) | 中文

## 概述

右侧栏的每个 Terminal 标签页持有一个运行在宿主上的交互式 shell，由 xterm.js 绘制，并处理尺寸适配、应用配色，以及让光标在所处单元格背景下保持可辨。标签页携带 shell 的标题，因此多个 shell 可以区分；没有已记住命令的标签页会停在启动引导处，而不是自行猜测。shell 比窗格更长久：切换会话只是断开视图而 shell 继续运行，关闭标签页才会关闭 shell。shell 的任何信息都不存放在浏览器中。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web 客户端需要在右侧栏提供 shell 时编排本插件。它需要 `sidebarContent`、`webTerminals`、`locale` 与 `theme`。`apply` 在插件 fiber 的 effect 中注册 `terminal` 窗格及其字典，窗格通过 `ctx.webTerminals` 为每个标签页挂接一个终端视图。窗格挂载期间会持有其 shell，因此宿主让该 shell 保持存活；某个标签页的最后一个窗格卸载时，持有被释放。实时主题以快照形式经 `theme/change` 到达，每个窗格据此为其模拟器与光标重新着色。

-----

<a id="further-exploration"></a>
## 延伸阅读

当窗格自身契约不足以说明问题时阅读这些：它加入的那一栏，以及它跟随的主题。

- [ui-sidebar-select](../ui-sidebar-select/README.zh.md) —— 本窗格注册进入的内容注册表。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md) —— 渲染会话标签页的那一栏。
- [ui-theme](../ui-theme/README.zh.md) —— 模拟器与光标跟随的主题快照。

-----

<a id="model-experience"></a>
## 模型体验

None, as the pane only attaches an xterm view to a shell that lives on the Host behind `ctx.webTerminals`; what the model sees of a shell is owned by the bash tool, not by this plugin.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定窗格拥有什么、宿主拥有什么。

- **无不变式伴生入口**——不发布不变式伴生入口，因为该窗格只拥有一个内容种类注册，以及窗格挂载期间取得的持有，二者随插件 fiber 一同撤下；而 shell、其回滚缓冲与生命周期由宿主的终端服务拥有并报告，窗格只原样呈现其答复。
- **窗格不保留终端状态**——它挂接到宿主为其标签页报告的 shell；未被持有的 shell 可能在配置的空闲超时后被释放。
- **没有已记住 shell 的标签页会停在启动引导处**——在读者选定命令之前不会启动任何进程。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
