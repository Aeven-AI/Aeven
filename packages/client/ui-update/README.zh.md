---
description: "桌面更新弹窗：Electron shell 的发布流状态、下载进度，以及 Aeven 替换自身之前由读者回答的重启问题。"
kind: "package-reference"
---

# @aeven/client-ui-update

[English](README.md) | 中文

## 概述

本包渲染桌面更新弹窗：`shell.overlay` 中的一项，镜像 Electron shell 的发布流——正在检查、正在下载、已可安装、正在安装或失败——并在 Aeven 重启安装之前询问读者。发布流归 shell 所有：它检查 GitHub 发布源、在读者继续工作的同时下载已签名的发布，并执行替换；本包只发布 shell 的状态，并把读者的三种回答送回（重新检查、重启并安装、关闭）。同一个客户端经 HTTP 提供时没有 preload 载体，因此不注册任何内容，也不显示任何内容。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 Electron shell 所渲染的客户端中挂载本插件。应用菜单的 **检查更新…** 会打开弹窗并开始检查；后台下载的发布在下载完成时也会打开它一次。检查或下载进行期间，弹窗显示共享的加载标记与正在处理的发布；发布落到磁盘后，它询问 **重启并安装** 或 **稍后**。退出时不会安装任何东西：未作此回答就退出，当前运行的发布保持不变。

只有已打包并签名的应用才能安装发布；未签名的构建或未打包的开发运行只会报告最新发布或失败，不提供重启。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包向 `shell.overlay` 贡献一项（`UpdatePopup`）。Electron preload 暴露 `window.avnDesktop.update`（`get`、`check`、`install`、`onChange`）以及应用菜单订阅；插件在 `apply` 中订阅 shell 发布的状态，把它们写入一个由条目声明的 store，渲染器将其绑定为组件的 `useUpdate` 钩子。`update-carrier.ts` 镜像 shell 的状态联合，`update-store.ts` 保存弹窗渲染的两个事实：最后发布的状态，以及读者是否已打开它。`get` 或 `check` 失败时，弹窗停留在当前显示的状态，因为 shell 自身的状态走另一条通道到达。shell 的信号与重启决策由 [桌面更新](../../../.agents/notes/implemented/feature/2026-10-16-desktop-automatic-updates.zh.md) 负责。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [`@aeven/desktop`](../../../apps/desktop/README.zh.md) — 拥有发布流、下载与安装的 Electron shell。
- [ui-settings-general](../ui-settings-general/README.zh.md) — 另一个仅桌面存在的界面，同样读取 preload 载体。
- [Web 客户端架构](../../../docs/subsystems/web-client.zh.md) — 浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无。本包为人类渲染 shell 的发布状态，不触及提示词、消息、schema、流或工具结果。

#### KV Cache 影响

无；本包从不组装或发送 provider 请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **弹窗只显示 shell 报告的内容** — 下载大小、传输速度与剩余时间不在 shell 的状态中，因此弹窗无法显示。
- **读者不在时完成安装不会在返回后报告** — 安装会重启应用，新进程以空的状态流开始，弹窗没有历史可显示。
- **只有一个发布界面** — 自动检查发现的发布在下载完成后打开弹窗；下载进行期间，应用外壳中没有单独的提示。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

preload 契约位于 `apps/desktop/src/ipc.ts`（`AvnDesktopUpdateApi`）；`update-carrier.ts` 以结构化方式重述它，因为 shell 是应用而非客户端可导入的包。相位或字段变化时，请保持两者一致。

</details>

**运行时不变式：** 不发布伴生文件。本包把 shell 发布的状态投影到一个 overlay 条目上，不拥有任何跨插件的可变状态；其唯一的槽位注册通过 HMR 安全测试证明可释放。
