---
description: "右侧栏浏览器：会话旁的 Electron webview 访客、其控件，以及 Agent 的浏览器自动化。"
kind: "package-reference"
---

# @aeven/client-ui-sidebar-browser

[English](README.md) | 中文

## 概述

右侧栏的浏览器面板，供在 Electron 桌面外壳中查看的会话使用。该面板内嵌一个 Electron `<webview>` 访客，并由自身的控件驱动它：地址栏把读者输入的内容解析为地址或搜索，以及后退、前进、刷新、打开 DevTools 与缩放控件、设置 → 通用 中的搜索引擎行，还有把点击的链接送往本面板、Host 的 Chromium 或操作系统浏览器的链接菜单。登录状态与站点数据按 Aeven 账户保存，因此在某个站点登录一次后，它在每个会话旁和重启后都保持登录。Agent 工作期间，它的指针被保持在面板之上，并绘出每个动作指向的位置。同一个访客通过 `browser/automation` Remote Event 应答 Agent 的 `browser_*` 工具，因此模型驱动的是读者正在看的页面。以 HTTP 提供时既没有 webview 也没有外壳桥接：浏览器类型改为打开 Host 的 Chromium 窗口，链接则在标签页自身中打开。

## 目录

- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="model-experience"></a>
## 模型体验

### 浏览器自动化

#### 模型看到什么

通过 `browser_*` 工具看到该会话的页面：status 或 navigate 返回的地址、标题与加载状态，以及在访客中执行的每个动作的 JSON 结果；工具 schema 及其措辞归 `avn-tool-browser` 所有。

#### Token 影响

只有 `avn-tool-browser` 渲染的工具结果会进入请求；面板的控件、菜单与指针不增加任何文本。

#### KV Cache 影响

无；面板绘制的都是会话已记录的状态。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **内嵌访客需要桌面外壳** —— 网页既没有 `<webview>` 也没有外壳桥接，因此浏览器类型改为打开 Host 的 Chromium，面板的链接菜单也不会安装。
- **未挂载面板的会话没有页面** —— 自动化事件会向下传递，工具报告浏览器已关闭，因此只有当读者打开该面板时 Agent 才能驱动它。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为本包不保留任何宿主侧状态：Host 半边只注册一个设置命名空间并读取一个 Remote，而访客、它的链接处理与自动化应答只存在于页面中并随页面一起消失。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
