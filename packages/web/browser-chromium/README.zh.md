---
description: "Host 为浏览器界面运行的 Chromium：一个远程调试端口、一个共享的配置文件目录，以及消费者报告的状态。"
kind: "package-reference"
---

# @aeven/browser-chromium

[English](README.md) | 中文

## 概述

`@aeven/browser-chromium` 启动并定位部署的浏览器界面所驱动的 Chromium。它以专用配置文件目录在远程调试端口上启动配置的可执行文件，且不带 `--enable-automation`，然后在该端口应答之后报告调试端点。若该端口上已有浏览器应答，则把它切到当前标签页而不是重新启动；一个配置文件目录服务所有会话，因此某个站点登录过一次便保持登录；并发的调用方等待已经在进行中的那次启动。配置指定了 MCP 服务器时，调用其工具之一会先确保浏览器已经应答。`status()` 在不启动任何东西的前提下采样浏览器是否在运行、以及是否可以启动。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在提供浏览器界面的 Host（例如侧边栏浏览器）上挂载它。`port` 必填，且必须与作为 `--browserUrl` 交给 chrome-devtools-mcp 的端口一致；`executablePath` 依次回退到 `AVN_CHROME_PATH` 与平台安装路径，找不到浏览器的 Host 会带警告继续运行。`userDataDir` 默认为 `<AVN_HOME>/runtime/chrome-profile`，`mcpServerName` 默认为 `chrome_devtools`（留空则关闭「调用时启动」），`launchOnStart` 在插件启动时启动浏览器。驱动工具会以配置文件中已登录站点的身份操作，因此网站上类似发送的调用会先征求用户同意：点击标签为发布动词（Send、Post、Create、Submit、Reply、Comment、Share、Connect 及其荷兰语、西班牙语、德语、法语和中文形式）的按钮或菜单项的 `click`，点击未在快照中见过的元素的 `click`，`click_at`，带 Enter 且不带 Shift 的 `press_key` 或 `type_text`，含换行的 `type_text`，以及发送 POST、PUT、PATCH 或 DELETE 请求、或在源码含发布动词时执行点击、派发事件或提交的 `evaluate_script`；只读取的脚本不需要询问。输入、填写、读取和导航不需要询问，本机提供的页面也从不询问。审批按站点提供「本会话允许」，该授权同样覆盖同一站点上的侧边栏 `preview_*` 工具。发布动词规则以导出形式提供（`isSendControl`、`isSendKey`、`isSendScript`、`pageSite`、`sendApproval`），使每个浏览器界面以相同方式判定发送。

<a id="model-experience"></a>
## 模型体验

### Host 浏览器界面

#### 模型看到什么

本包不写入提示词文本，也不注册自己的工具。它的事实经消费者到达模型——`preview_status` 报告 `browserUrl`、`running`、`launchable` 与 `toolPrefix`——而 `toolPrefix` 之下的工具属于驱动该浏览器的 MCP 服务器。用户拒绝的类似发送调用会以工具运行时的拒绝信息作为该调用的错误结果返回。

#### Token 影响

本身无影响；它的事实只在消费者的工具结果里消耗 token。

#### KV Cache 影响

无；本包不贡献请求期文本。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为它报告的每一项事实都采样自它自己启动的那个调试端点，伴随模块只会读取实现已经在读取的端口。
- **一个配置文件目录由所有会话共享**——登录过一次的站点会保持登录，因此需要未登录浏览器的读者要清空该配置文件目录。
- **发送闸门读取标签而非意图**——标签不在清单中的发布控件（例如没有无障碍名称的纯图标按钮）会不经询问执行，而标签为清单动词的非发布按钮会询问。它从观察到的工具结果中学习目标和页面地址，因此 Host 重启后，点击会一直询问，直到模型再次获取快照。
- **浏览器缺失时失败的是调用而非 Host**——插件加载时找不到可执行文件会记录警告，随后工具调用会失败并指明无人应答的端口。

<a id="dev-note"></a>
### 开发备注

无。
