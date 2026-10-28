---
description: "会话移交的 Service Definition（`ctx.sessionHandoff`）：在另一台设备编写的对话中输入、审批并接管。"
kind: "package-reference"
---

# @aeven/session-handoff

[English](README.md) | 中文

## 概述

`ctx.sessionHandoff` Service Definition。已同步账户的对话同一时刻只有一台设备在编写，而持有副本的其他设备仍然接收用户对它的输入：`forward` 把提示词、审批决定或取消发送给编写的设备，由它通过 `session-handoff/input` 作为自己的输入应用；`publishLive`/`liveOf` 把该设备的运行状态和队列传给其余设备。`catalog` 在正文到达前列出账户的对话元数据，`fetch` 在打开时下载单个对话，`runnerOf` 指出正在编写的设备，`claim` 在该设备没有轮次运行时把本机变为编写方，接管时会在停止编写的设备上发布 `session-handoff/released`。由 `@aeven/session-sync` 提供。见[账户同步分组](../../sync/README.zh.md)。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

本身没有，因为移交只在设备之间搬运输入，不向模型请求添加任何内容。转发的提示词会成为编写设备会话日志中普通的 `user/message`，因此模型看到的它与在本地输入完全相同。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **转发的输入会等待编写方** — 编写的设备在线、或在同一局域网上直接相连时，输入才会到达；否则它留在账户的收件箱流中。
- **接管需要完整的副本** — 设备只有导入编写方发布的全部事件后才会接管会话，因此对落后的副本调用 `claim` 会返回 `{ claimed: false }`。
- **与分组共享** — 账户同步的其余限制见[分组 README](../../sync/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>供维护者参考的工作上下文 — 点击展开</summary>

输入词汇属于转发并应用它的 Consumer；本 Service Definition 只把它作为操作名和 JSON 请求原样传递，因此新的控制（引导、工具回答）在这里无需改动。

</details>
