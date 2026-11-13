---
description: "按账户保存录音机的录音：转录经账户同步镜像，音频文件经文件同步共享。"
kind: "package-reference"
---

# @aeven/recordings

[English](README.md) | 中文

## 概述

`ctx.recordings` 为每个账户保存录音机已完成的录音。一个账户的转录保存在 `dataRoot` 下的一个 JSON 文件中，并镜像到该账户同步的 `recordings` 文档，因此会出现在它的所有设备上；最后修改的条目胜出，删除会留下墓碑记录，在所有设备上移除录音及其音频。音频是每段录音一个文件，存放在账户的音频文件夹中，文件同步运行时会把该文件夹共享给账户的其他设备。本宿主不同步的账户（例如没有登录用户时）会把录音保存在本地。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

以绝对路径 `dataRoot` 编排本插件；`maxAudioBytes` 限制一段录音的音频大小。每个方法都以 `owner` 接收账户（没有登录用户时为 `LOCAL_OWNER`）：`list` 按从新到旧返回摘要，`get` 返回一段录音，`save` 保存一段含有已转录语音的录音，`rename` 与 `remove` 修改一段录音，`appendAudio`、`finishAudio` 与 `readAudio` 分块传输它的音频。`recordingId` 会在任何非 UUID 的 id 成为文件名之前拒绝它。服务在 `sync/status` 时打开账户的同步文档，与本地条目合并，并在编排了 `ctx.fileSync` 时通过它共享音频文件夹。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [api-speech-to-text](../api-speech-to-text/README.zh.md) —— 把本存储暴露给浏览器的 `speech` Remote 方法。
- [ui-sidebar-meeting](../../client/ui-sidebar-meeting/README.zh.md) —— 录音机，它把录音保存到这里并列出它们。
- [sync](../../sync/sync/README.zh.md) 与 [file-sync](../../sync/file-sync/README.zh.md) —— 本存储所依托的账户同步与文件同步。

-----

<a id="model-experience"></a>
## 模型体验

无，因为保存的转录与音频留在账户自己的存储中；只有当用户把转录添加到聊天时，它才会进入请求。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **无不变式伴生入口** —— 不发布不变式伴生入口，因为每个账户的条目只有一个所有者，即本服务，它在同一次提交中写入本地文件与同步文档，不存在可与之背离的独立观察。
- **音频依赖文件同步** —— 没有文件同步的宿主（例如托管应用）能收到转录，但收不到音频；正因如此，录音机只在桌面应用中编排。
- **重命名没有界面** —— `rename` 已存在，但录音机的弹窗没有提供它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 —— 点击展开</summary>

无。

</details>
