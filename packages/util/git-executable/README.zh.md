---
description: "查找本设备的 Git 可执行文件：先查 PATH（跳过 macOS 的安装对话框存根），再查各平台的标准安装位置。"
kind: "package-reference"
---

# @aeven/git-executable

[English](README.md) | 中文

## 概述

`findGit` 返回本设备的 Git：`PATH` 解析到的可执行文件，除非它是 macOS 上在缺少开发者工具时打开 Apple 安装对话框的 `/usr/bin/git` 存根；否则返回平台标准安装位置中的第一个（macOS 上的 Homebrew、命令行工具和 Xcode；Windows 上程序目录下的 Git for Windows；Linux 上的 `/usr/bin` 和 `/usr/local/bin`）。桌面应用较短的 `PATH` 以及进程运行期间新安装的 Git 都会错过这些位置，因此 [`@aeven/vcs-git`](../../vcs/vcs-git/README.zh.md) 和 [`@aeven/workspace-git-sync`](../../workspace/workspace-git-sync/README.zh.md) 使用它。`PATH` 查找由调用方提供，因此该包只依赖 Node 内置模块。

## 目录

- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **固定位置** — 安装在其他位置的 Git 只能通过 `PATH` 找到。

<a id="dev-note"></a>

<a id="开发备注"></a>
### 开发备注

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为这个纯查找不拥有事件流或可变的运行时数据。
