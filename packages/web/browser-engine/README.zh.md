---
description: "代理的浏览器引擎：通过 Chrome DevTools 协议执行 preview_* 操作，采用 ChatGPT 的指针时序，由侧边栏浏览器、Chrome 和 Aeven 扩展共用。"
kind: "package-reference"
---

# @aeven/browser-engine

[English](README.md) | 中文

## 概述

通过 Chrome DevTools 协议在一个浏览器标签页上执行 `preview_*` 工具背后的操作：点击、输入、滚动、读取、等待、快照、截图、对话框、上传、WebMCP 和导航。同一个引擎驱动桌面应用的侧边栏浏览器（Electron guest）、经 DevTools WebSocket 连接的 Chrome 标签页，以及 Aeven 浏览器扩展通过 `chrome.debugger` 控制的标签页，因此代理使用的每个浏览器表现一致。它既不导入 Electron 也不导入 Node：它在计算机上可以做什么（附加文件、保存下载、使用剪贴板）由宿主以 `EngineHost` 提供。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

`automate(target, operation, input, signal, host)` 在一个 `BrowserTarget` 上运行一个操作并返回其 JSON 结果。目标是一个 CDP 会话，加上标签页的地址、标题、按键输入，以及 `presentCursor(step, wait, timeoutMs, signal)`：它绘制代理指针，并在需要时于指针到达后完成。`ChromeTab` 从任意 `TabChannel`（发送命令、订阅事件、报告是否打开）构建目标，并用传入的覆盖层页面脚本绘制指针；`prepareTab` 启用引擎监听的域，并把该脚本安装到标签页打开的每个文档中。

没有任何成员的 `EngineHost` 会拒绝文件上传、Google Docs 导出和剪贴板访问；浏览器扩展使用这样的宿主运行，桌面应用使用能访问计算机文件、“下载”文件夹和剪贴板的宿主。

<a id="understand-the-implementation"></a>
## 理解实现

指针时序遵循 ChatGPT 的浏览器代理：指针先到达（最多 1500 ms），然后才发送页面的鼠标事件；点击最多等待 3000 ms，等待在 250 ms 内开始的导航；后退、前进和重新加载最多等待 10,000 ms；拖动只在第一个点等待指针；滚动发送一次滚轮事件，并在滚动位置稳定后返回。没有人能看到的标签页不绘制需要等待的指针。`page-scripts.ts` 包含页面侧的定位器（CSS、`text=`、`role=`、`label=`、`xpath=`、`>>`、`nth=`、`visible=`）、markdown 阅读器和 YouTube 字幕阅读器。

## Known Limitations and Deferred Work

- **每次调用只作用于一个标签页** —— 操作作用于传入的目标；选择哪个标签页由调用方决定。
- **除 CDP 隔离环境外不访问跨源框架** —— `frame` 参数可以到达同进程的 iframe；进程外的 iframe 无法定位。
- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为引擎除传入的标签页外不跨调用保留状态；调用方的测试和实时检查覆盖每个操作。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

这些时序取自 ChatGPT 浏览器代理的数值，依据其可观察的行为重新实现；只能与覆盖层的运动一同修改，因为到达等待依赖于它。

</details>
