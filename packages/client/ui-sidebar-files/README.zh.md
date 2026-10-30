---
description: "右侧栏的 Files 内容种类：把会话工作区呈现为按文件夹逐个加载的树、名称搜索，以及打开文件的查看器。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-files

[English](README.md) | 中文

## 概述

右侧栏的 Files 标签页展示会话工作区：一棵每次请求加载一个文件夹的树、对整个工作区的名称搜索、打开文件的代码与 Markdown 渲染，以及针对行路径的桌面打开操作。内容插件通过该栏的注册表加入，因此本包贡献 `files` 窗格、文案与 `sidebarFiles` 打开器。文件夹、文件文本与搜索命中按需从 `workspaceFiles` Remote 读取；已展开的文件夹、查询词与树的停靠状态按会话与标签页保存在浏览器内存中，因此重新加载会回到根目录。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web 客户端的侧栏应当浏览会话工作区时编排本插件。它需要 `sidebarContent`、`remote`、`remote.workspaceFiles` 与 `remote.session`。`apply` 在插件 fiber 的 effect 中注册 `files` 窗格及其字典，因此销毁 fiber 会撤下该种类，且注册会等待该栏的注册表，而不是与该栏自身的 apply 竞争。窗格用 `workspaceFiles.list` 列出一个文件夹，用 `workspaceFiles.read` 读取打开的文件，用 `workspaceFiles.search` 搜索名称，并用 `session.canOpenWorkspacePath`、`session.workspacePathApplications` 与 `session.openWorkspacePath` 支撑行菜单。

`sidebarFiles.open(sessionId, path)` 聚焦已显示所请求文件的 Files 窗格，或打开新的窗格，并显示侧栏。对于 PDF、Office、iWork、OpenDocument 以及没有侧栏查看器的其他二进制文件，打开器返回 `false`，以便调用者使用默认应用。树、搜索和行菜单中的打开操作直接将这些文件交给 Host 默认应用，不打开侧栏查看器。请求会等待选定窗格挂载；查看器通过 `workspaceFiles` 读取文件并保留工作区访问检查。

-----

<a id="further-exploration"></a>
## 延伸阅读

当窗格契约本身不足以说明问题时阅读这些：它加入的该栏，以及该席位背后的组合模型。

- [ui-sidebar-select](../ui-sidebar-select/README.zh.md) —— 本窗格注册进入的内容注册表与标签页集合。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md) —— 渲染会话标签页的那一栏。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) —— 浏览器插件行如何加载并注册插槽。

-----

<a id="model-experience"></a>
## 模型体验

None, as the explorer reads folders, file text, and search hits through the `workspaceFiles` Remote and renders them without contributing context; the model reads files with its own tools.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定浏览器展示什么、把什么留给宿主。

- **无不变式伴生入口**——不发布不变式伴生入口，因为该窗格只拥有 effect 作用域内的注册：内容注册表中的 `files` 条目与其本地化字典，而它展示的每个值都从 `workspaceFiles` Remote 重新读取，因此这里不持有可与宿主答案相互比较的副本。
- **树每次请求只加载一个文件夹**——文件夹在被展开时才到达，因此父文件夹处于折叠状态的文件只能通过名称搜索找到。
- **搜索匹配名称而非内容**——正文中出现查询词的文件不算命中。
- **记住的浏览状态不会跨重新加载**——已展开的文件夹、查询词与停靠状态存在浏览器内存中，仅限已挂载的会话与标签页。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
