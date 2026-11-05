---
description: "工作区命名界面的浏览器端：用一个对话框在读者输入的名字下创建没有目录的 Workspace，挂载在 Host 不为 Workspace 提供文件夹的组合里。"
kind: "package-reference"
---

# @aeven/client-ui-workspace-name

[English](README.md) | 中文

## 概述

不保留工作区文件夹的 Host 无法提供 ui-workspace 声明的目录流程，于是本包用对话框填上这两处：读者输入名字，Workspace 就以该标题、不带目录地创建。其他组合里目录选择器照旧，同一个洞后面换的是另一种注册。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

在工作区没有文件夹的组合上用它替代 `client-ui-directory-picker-browse` 或 `client-ui-directory-picker-native`，例如 Aeven 的托管版 Web。其余不变：新建工作区仍打开该流程，流程仍落到 `workspace.create` 与目录变更的洞，创建出来的 Workspace 照常打开。

<a id="understand-the-implementation"></a>
## 理解实现

插件通过 `slots.inject()` 注册对话框字典与两个目录流程的洞，因为 ui-workspace 的入口可能稍后才激活或替换自己的声明。对话框只收集标题；创建仍调用 ui-workspace 已有的那次调用，只是不带目录。

<a id="further-exploration"></a>
## 进一步探索

- [工作区界面](../ui-workspace/README.zh.md)
- [Web app bundle](../../bundle/web-app/README.zh.md)

<a id="model-experience"></a>
## 模型体验

无。该包是浏览器端 UI 插件层，不注册任何面向模型的内容。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **只有名字**——没有文件夹，因此在这样的 Workspace 里开始的会话运行在 Host 所在的位置，而这正是托管组合的本意。
- **创建时不能改名**——对话框每次提交创建一次；改名仍是 ui-workspace 自己的控件。
- **它是替代而非共存**——一个组合只挂载一套目录流程，想要两者兼得的部署需要自己的决策界面。


### 开发备注

不发布 invariant 伴随模块：该包只注册一个对话框，其运行时关系完全由它的测试驱动观察。
