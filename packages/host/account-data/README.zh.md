---
description: "Host 上已登录账户的数据权利：以流式 zip 导出账户在此处和 Aeven API 上的全部数据，并清除 API 已彻底删除的账户的本地数据。"
kind: "package-reference"
---

# @aeven/host-account-data

[English](README.md) | 中文

## 概述

`@aeven/host-account-data` 提供 `GET /api/account-data/export`，即“设置 → 账户 → 导出数据”背后的下载。响应立即开始：浏览器读取的同时写入 zip，文件只在归档写到它时才打开，Host 在内存中只保留一个数据块和至多一份聊天记录。小文本以 1 级压缩，媒体和大文件直接存储。Aeven API 上的账户副本（`GET /api/account/export`）与本地遍历并行获取，最后写入。

在 Aeven API 上删除账户会开始 30 天的宽限期；之后 API 彻底删除账户，只保留用户 ID 的 SHA-256，它也是该账户主目录的名称。本服务在启动时和定期向 `POST /api/account/deleted` 询问它持有数据的每个账户，并清除每个已彻底删除的账户，因此每台桌面设备和托管副本都会忘记该账户，即使删除时它们不在线。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

```yaml
- id: account-data
  name: '@aeven/host-account-data'
  config:
    apiUrl: !!js process.env.AEVEN_API_URL ?? 'https://aeven.io/api'
```

| 字段 | 默认值 | 含义 |
| --- | --- | --- |
| `apiUrl` | 必填 | Aeven API 地址。 |
| `credentialRef` | `AEVEN_TOKEN` | 保存每个用户 Aeven 访问令牌的凭据，用于获取 API 副本。 |
| `checkDelayMs` / `checkIntervalMs` | 60 秒 / 6 小时 | 何时查询已彻底删除的账户。 |
| `compressMaxBytes` | 8 MiB | 压缩的最大文本文件；`0` 表示全部直接存储，不消耗压缩 CPU。 |
| `compressionLevel` | 1 | 压缩条目的级别。 |
| `chatFiles` | 无 | 每个账户的导出都包含、且从不清除的设备级文件夹；桌面端设为其聊天文件夹。 |
| `maxConcurrentExports` | 0（不限） | 跨账户同时进行的导出数；超出时路由返回 429。 |
| `maxBytesPerSecond` | 0（不限） | 每个导出的吞吐上限。 |
| `skipDirectories` | `node_modules`、`.venv`、`venv`、`__pycache__` | 每个导出目录树中排除的目录名：可安装的工具，而非账户数据。 |

`GET /api/account-data/export/progress` 为调用者正在进行的导出返回 `{ fraction }`：已读入归档的字节数相对于估算值，估算预先计量非聊天数据源，并按已写入聊天的平均值估算聊天，归档结束前绝不为 1。设置页面以进度条显示。无论限制如何，每个账户一次只进行一个导出；第一个完成或取消前，第二个请求返回 429。托管包允许同时两个导出，每个 25 MB/s。

保存按账户数据的插件注册一个数据源：

```ts
import { rm } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@aeven/host-account-data'

export function registerRecordings(ctx: Context, dirOf: (owner: string) => string): void {
  ctx.inject(['accountData'], (scoped) => {
    scoped.effect(() => scoped.accountData.register({
      name: 'recordings',
      export: async (owner, out) => { await out.directory('recordings', dirOf(owner)) },
      erase: async (owner) => { await rm(dirOf(owner), { recursive: true, force: true }) },
    }), 'recordings: account data')
  })
}
```

`owners()` 可选，列出该数据源持有数据的账户，供彻底删除检查查找。

<a id="understand-the-implementation"></a>
## 理解实现

归档是 `yazl` zip（超过 4 GiB 时使用 ZIP64）。条目通过 `addReadStreamLazy` 添加，因此文件描述符只在写入其条目时才打开，遍历后被删除的文件会成为空条目。yazl 会保留每个条目直到写入中央目录，所以生成函数在其唯一一次调用之后不得持有内容。输出每次读取拉取一个数据块，因此归档只随下载消耗而推进。

此处注册的数据源：聊天（账户拥有的每份会话记录，解码为 JSON Lines，并附带其中的图片和文件）、记忆（逐页读取的每条记录）以及账户主目录（技能、自动化、连接器设置和消息存储）。主目录导出不包含凭据：`credentials.json`、Telegram 会话、WhatsApp 设备密钥、同步副本、记忆存储、连接器缓存和锁文件。录音、个性化、Aeven 文件夹、技能与已连接服务、消息反馈以及 `working-directory` 的托管聊天文件夹各自注册数据源。

不发布运行时不变量配套检查；数据源各自拥有其存储，一次导出或清除只是对它们的一次遍历，没有需要校验的第二份观察。

<a id="model-experience"></a>
## 模型体验

无，因为导出和清除从不进入会话记录、模型请求或系统提示。

#### KV Cache 影响

无；请求内容不变。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- 429 在浏览器下载中显示为下载失败；页面尚未解释原因。
- `recovery/` 下的会话恢复副本不归属于任何账户，因此彻底删除会保留它们。
- 账户被彻底删除时仍在运行的会话会拒绝删除；下一次检查会清除它。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作背景 — 点击展开</summary>

设计与考虑过的替代方案见 [Agent Note](../../../.agents/notes/implemented/feature/2026-11-17-account-data-export-and-deletion.zh.md)。

</details>
