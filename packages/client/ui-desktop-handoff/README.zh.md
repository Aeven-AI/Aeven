---
description: "桌面版衔接的浏览器端：托管版 Web 客户端用「可在 Aeven 桌面版中使用」弹窗替代 Files、Browser、Terminal 与 Devices 面板。"
kind: "package-reference"
---

# @aeven/client-ui-desktop-handoff

[English](README.md) | 中文

## 概述

在无法访问读者电脑的 Host 上，右侧栏的 Files、Browser、Terminal 与 Devices 入口仍留在原处，但打开的是同一个弹窗：「可在 Aeven 桌面版中使用」，其中有下载链接与「在 Aeven 桌面版中打开」。当 Host 因为对话位于并未运行它的设备上的文件夹而拒绝一段提示词时，也会弹出这个弹窗。桌面版应用从不挂载本包，因为在那边这些入口就是真实的面板。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

让会话没有自己机器的 Web 组合会挂载它：ui-sidebar-select 中 `files`、`browser`、`terminal`、`device` 四行注册的是弹窗打开器而不是面板，`shell.overlay` 承载弹窗本身。下载页来自部署自己的站点；没有配置站点的部署不提供下载，只保留衔接操作。

<a id="understand-the-implementation"></a>
## 理解实现

`createHandoffStore()` 在注册时声明，保存弹窗是否打开以及原因。侧栏入口与对话的 `workspace/no-local-directory` 拒绝处理器调用 `show(reason)`，弹窗从 store 渲染，所有文案都在 `desktop-handoff` 语言命名空间中。

<a id="further-exploration"></a>
## 进一步探索

- [Web app bundle](../../bundle/web-app/README.zh.md)
- [桌面应用](../../../apps/desktop)

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无法得知是否已安装 Aeven 桌面版**——浏览器没有途径询问，所以「在 Aeven 桌面版中打开」总是显示「没有打开？」的提示，而不会随之调整。
- **一次只讲一个原因**——一个会话若有多个仅本地可用的面板，弹窗只解释最先打开的那个。
- **下载链接属于部署文案**——不提供站点 URL 的 Host 既没有下载操作也没有版本信息。


### 开发备注

不发布 invariant 伴随模块：该包的 store 与注册由它自己的测试观察，也不存在两个独立观察者可能看法不一致的关系。
