---
description: "右侧栏的内容选择：按会话维护的 Browser、Terminal、Files 与 Device 标签页集合、全屏切换，以及内容插件加入的注册表。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-select

[English](README.md) | 中文

## 概述

右侧栏把会话内容呈现为标签页——Files、Browser、Terminal 与 Device——而本包拥有这一选择：会话打开了哪些标签页、显示哪一个、哪些种类背后有提供方，以及该栏是否处于全屏。内容插件通过 `ctx.sidebarContent` 加入，它为注册的种类给出对应的窗格；没有提供方的种类仍会列出，但无法被选中。已打开的标签页按会话记录在浏览器存储中。本包同时安置把会话该栏切到全屏的角落控件。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当右侧栏需要提供内容种类时编排本插件。它需要 `slots`、`locale` 与 `layout`。`apply` 以插件形式启动内容注册表，注册 `sidebar.right.body` 与框架角落的全屏切换，并贡献其字典；随后每个内容包在自身的 effect 中调用 `ctx.sidebarContent.register(kind, Pane)` 或 `registerLauncher`。已显示的标签页保存在 `avn.sidebar-right.surfaces` 下，标签页之前的单一选择保存在 `avn.sidebar-right.content` 下，每个会话一条记录。

-----

<a id="further-exploration"></a>
## 延伸阅读

当选择本身的契约不足以说明问题时阅读这些：填充它的种类，以及绘制它的那一栏。

- [ui-sidebar-files](../ui-sidebar-files/README.zh.md) —— Files 窗格。
- [ui-sidebar-device](../ui-sidebar-device/README.zh.md) —— Device 窗格。
- [ui-sidebar-terminal](../ui-sidebar-terminal/README.zh.md) —— Terminal 窗格。
- [ui-sidebar-right](../ui-sidebar-right/README.zh.md) —— 本包占据其主体的那一栏。
- [插槽参考](../../../docs/subsystems/slots.zh.md) —— 本包所占用两个席位背后的组合模型。

-----

<a id="model-experience"></a>
## 模型体验

None, as the open pill set, the full screen state, and the content registry are browser viewing state; this package registers no tool, prompt section, or model-visible result.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定选择拥有什么、各窗格拥有什么。

- **无不变式伴生入口**——不发布不变式伴生入口，因为本包只拥有一个进程内的内容注册表及其主体与角落绑定，它们随插件 fiber 一同释放，而注册表自身的 `register` 会拒绝重复的种类，因此标签页集合没有第二个权威可与之发散。
- **标签页自身的状态属于其窗格**——该栏只记住哪些标签页打开、显示哪一个，从不记住某个窗格当时显示什么。
- **本构建无法渲染的已存种类会被丢弃**——由拥有其他种类的构建保存的会话会回到选择界面，而不是指向一个并不存在的窗格。
- **全屏按会话生效且不被记住**——切换会话会退出全屏。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
