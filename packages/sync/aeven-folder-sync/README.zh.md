---
description: "账户的 Aeven 文件夹：Aeven 存放为用户制作的文件之处，通过文件同步在每台设备上保持一致。"
kind: "package-reference"
---

# @aeven/aeven-folder-sync

[English](README.md) | 中文

## 概述

`ctx.aevenFolder` 服务管理 Aeven 文件夹：Aeven 存放为用户制作的文件（如演示文稿、简历、影片及其预览图）的目录。桌面应用把它设为 `~/Documents/Aeven`，并通过沙箱策略的 `writableRoots` 让每个会话无需询问即可写入。

账户同步和文件同步运行时，每台设备以从账户派生的同一个文件夹 id（`aevenFolderId`）共享其 Aeven 文件夹，因此账户的各台设备与加密的文件云副本无需协调即加入同一个文件夹。每台设备还把自己文件夹的绝对路径记录在账户的 `aeven-folder/paths` 文档中。`localPath(owner, path)` 把账户任一设备在其 Aeven 文件夹内写下的路径映射到本机上的同一文件；`/api/workspace-file` 路由使用它，因此一台 Mac 上回复展示的图片可以在账户的其他设备上打开。启用 `perAccount` 时，每个账户在 `<path>/<account>` 拥有自己的文件夹，供服务多个账户的 Host 使用。

| 配置 | 默认值 | 含义 |
|---|---|---|
| `path` | 必填 | 本设备上 Aeven 文件夹的绝对目录 |
| `perAccount` | `false` | 每个账户在 `<path>/<account>` 拥有自己的文件夹 |

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

### 运行时上下文，`advertise` 为 true 时

#### 模型看到的内容

在沙箱策略之后加入一条运行时上下文 `aeven-folder`，其中 `<path>` 替换为会话所属账户的文件夹绝对路径。演示文稿和简历技能指向该文件夹。

##### 此字段的原文

```markdown
Aeven folder: "<path>". Save the files you make for the user there, one folder per piece of work, unless they name another place: every device of their account and Aeven Web receive what it holds.
```

#### Token 影响

每次请求固定一行，约 45 个 token 加上路径。

#### KV Cache 影响

前缀稳定：该行在一个会话的每次请求中相同。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **路径只按文件夹前缀映射。** 在写入设备上经由符号链接或其他写法到达该文件夹的路径，不会映射到本机副本。
- **与文件同步组共享** —— 文件同步的限制统一列在[组 README](../README.zh.md#known-limitations-and-deferred-work) 中。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 —— 点击展开</summary>

设计见[同步的 Aeven 文件夹 Agent Note](../../../.agents/notes/implemented/feature/2026-11-16-synced-aeven-folder.zh.md)。

</details>

**运行时不变量：** 未发布运行时不变量伴随模块，因为文件夹及其发布的路径只由本设备写入，监听者可比较的每个值都归文件同步所有。
