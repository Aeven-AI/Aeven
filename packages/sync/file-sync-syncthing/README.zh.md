---
description: "文件同步的 Syncthing Service Provider：一个受监管的 Syncthing 进程，通过其回环 REST API 配置。"
kind: "package-reference"
---

# @aeven/file-sync-syncthing

[English](README.md) | 中文

## 概述

`ctx.fileSync` 的提供方。它通过 subprocess 能力在每个 Host 上运行一个 Syncthing 进程，主目录位于 `$AVN_HOME/file-sync/syncthing`，REST 监听在一个空闲的回环端口上，并使用随机 API 密钥；使用报告、崩溃报告和自动升级均关闭，进程以低优先级运行。每个共享文件夹都是收发文件夹，与本设备及其账户列出的对等设备（或其 `peers` 指定的部分设备）共享，使用分级版本保留、配置的忽略规则（默认包括 `.git` 以及依赖和构建目录）、一秒的监视器延迟，且没有拉取延迟。启动时会移除先前运行配置、但当前没有任何账户列出的设备和文件夹，因此在 Host 停止期间被移出账户的设备不会再次被信任。意外退出的进程会按退避策略重启。配置：`binary`、`home`、`listenAddresses`、`discoveryServers`、`localDiscovery`、`relays`、`watcherDelayS`、`pullerDelayS`、`rescanIntervalS`、`versionRetentionDays`、`ignores` 以及进程预算。

该提供方不运行 Syncthing 就从其密钥读取本设备的对等 id，并且只在某个账户有对等设备和可共享的文件夹时才启动 Syncthing，因此单设备账户从不运行它。冲突是 Syncthing 放在文件旁边的 `<name>.sync-conflict-<date>-<time>-<device><ext>` 副本；保留另一个版本会把副本移到文件上。文件夹摘要中的 `pullErrors` 成为 `failedFiles`。

## 目录

- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="model-experience"></a>
## 模型体验

无，因为文件同步在设备之间移动文件，不向模型请求添加任何内容。

#### KV Cache 影响

无。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- **与分组共享** — 文件同步的限制统一列在[分组 README](../README.zh.md#known-limitations-and-deferred-work)中。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时 invariant：** 不发布 runtime invariant companion，因为 Syncthing 自身的配置是提供方所写文件夹和设备的唯一副本。
