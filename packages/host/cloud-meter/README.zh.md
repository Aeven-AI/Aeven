---
description: "托管 Host 对 Aeven Cloud 工作的计量：把沙箱 CPU 时间、账户存储和自带模型的轮次报告给 Aeven API，并在账户额度用尽时阻止新的云端工作。"
kind: "package-reference"
---

# @aeven/cloud-meter

[English](README.md) | 中文

## 概述

`@aeven/cloud-meter` 把托管 Host 为每个账户做的云端工作计入该账户的 Aeven 额度。它以会话所有者的名义计量三类工作，由其 `AEVEN_TOKEN` 付费：

- 账户沙箱命令的 CPU 秒数，来自 `sandbox-jail/usage`；
- 账户文件夹的字节数，每天测量一次；
- 每个使用 Aeven API 不计费其推理的提供方的轮次。

它把这些发送到 `POST /api/cloud/meter/charges`，Aeven API 按其 `cloud` 配置定价、应用套餐折扣，先扣套餐额度，再扣购买的余额。API 报告为未付费的账户不能启动沙箱命令，也不能在不计费的提供方上开始轮次。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

`avn-hosted-app` 包在 `AVN_CLOUD_BILLING=1` 时挂载它，`apiUrl` 取自 `AEVEN_API_URL`，`accountsRoot` 设为沙箱的账户文件夹。在 Aeven API 提供 `/api/cloud/meter` 之后再打开该变量；价格和折扣在那里编辑，而不是在这里。

### 配置

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `apiUrl` | 必填 | 报告和报价发往的 Aeven API 源地址。 |
| `credentialRef` | `AEVEN_TOKEN` | 保存每个所有者 Aeven 会话的凭据。 |
| `flushIntervalMs` | `60000` | 两次发送排队报告之间的毫秒数。 |
| `quoteTtlMs` | `60000` | 所有者付费状态答复保持有效的毫秒数。 |
| `accountsRoot` | 无 | 其子目录为以所有者命名的账户文件夹的目录；省略时不计量存储。 |
| `storageIntervalMs` | `86400000` | 两次存储测量之间的毫秒数；首次测量在启动一分钟后进行。 |
| `billedProviders` | `@aeven/llm-aeven` 的提供方（`aeven-cloud`） | Aeven API 作为推理计费其轮次的提供方；其他提供方上的轮次会被计量。默认值读取自 `llm-aeven` 自身的常量。 |
| `maxQueuedPerOwner` | `10000` | API 不可达时每个所有者保留的报告数；最旧的先被丢弃。 |

### 未付费账户看到什么

沙箱命令以 `SANDBOX_UNAVAILABLE` 失败，不计费提供方上的轮次在其模型请求之前失败。两者带有同一条消息，提示用户充值或升级套餐。API 不可达或所有者没有令牌时，工作照常放行，报告在队列中等待。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部 —— 点击展开</summary>

### 报告与 id

CPU 秒数按所有者累加，直到下次发送时合成一条带随机 id 的 `sandbox` 报告。轮次的 id 是 `turn:<session id>:<turn>`，存储报告标明其 UTC 日期；某天的报告仍在等待时，当天之后的测量不再添加报告。报告在 API 接受之前保持其 id，因此请求失败后重发的报告只计费一次；API 的账本以账户和该 id 为键，存储则以日期为键。`400` 答复会丢弃该批次，因为重发不可能成功；其他失败会保留它。

### 付费状态

`GET /api/cloud/meter` 答复 `funded`，每次被接受的发送也会答复。答复按所有者缓存 `quoteTtlMs`。`sandbox-jail/admit` 是同步的，因此它用缓存的报价答复，并为下一条命令刷新过期的报价；`agent/request` 监听器在轮次的第一个请求之前等待报价。

### 源码地图

| 文件 | 作用 |
| --- | --- |
| [`src/index.ts`](src/index.ts) | 插件入口：配置、报告队列、报价、沙箱与轮次监听器、存储测量 |
| [`tests/cloud-meter.spec.ts`](tests/cloud-meter.spec.ts) | 针对脚本化 API 和替身 `du` 测试报告、重发、付费拦截和存储 |
| — | 不发布运行时不变量伴随包；插件保存的发送队列和报价缓存以 Aeven API 的账本为权威，本地没有第二个观察可以与之矛盾。 |

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 拒绝未付费账户

#### 模型看到什么

插件不注册工具、模式或提示词段落。对于 Aeven API 报告为未付费的账户，沙箱命令的工具结果带有 `SANDBOX_UNAVAILABLE` 和这条消息，不计费提供方上的轮次在其模型请求之前以同样的文本失败：

##### 拒绝消息

```markdown
This account's Aeven credit is used up, so Aeven Cloud cannot run this. Add credit or upgrade the plan in Settings, Account, to continue.
```

#### Token 影响

账户已付费时没有影响；被拒绝的命令在其工具结果中追加这一句话。

#### KV Cache 影响

前缀稳定：插件不改变请求内容，拒绝作为工具结果追加。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **排队的报告保存在内存中**：Host 重启最多丢失一个间隔的 CPU 秒数，以及 API 尚未接受的报告。
- **按 CPU 时间而非墙钟时间**：等待或休眠的命令在等待期间不计费，用满账户上限两个 CPU 的命令按双倍计。
- **存储用 `du -sk` 测量**，即文件夹占用的磁盘空间：每个账户文件夹每天遍历一次，文件夹越大耗时越长。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 —— 点击展开</summary>

无。

</details>
