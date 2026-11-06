---
description: "面向在一个 Host 上运行多个账户的运维者：在不 fork 大型 Host 的前提下启动命令的子进程运行时。"
kind: "package-reference"
---

# @aeven/subprocess-executor

[English](README.md) | 中文

## 概述

`avn-subprocess-executor` 为会变得很大的 Host（例如服务多个账户的 Host）提供 `ctx.subprocess`。fork 大型进程会复制其页表，期间 Host 的事件循环无法服务任何人：在托管机器上，1.2 GB 的父进程每条命令耗时 38.7 毫秒，而通过本运行时为 3.2 毫秒，事件循环的停顿也从 38.9 毫秒降到 0.8 毫秒。它保留本地运行时的进程所有权、输出收集、环境清理和进程树信号，只替换命令的启动方式：一个小型辅助进程维护空闲启动器，命令通过 `exec` 取代其中一个，保留其 pid 和进程组。池无法服务的调用退回普通 spawn。仅限 POSIX。

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

用它替代 [`avn-subprocess-local`](../subprocess-local/README.zh.md) 挂载；`ctx.subprocess` 的每个消费方无需改动。[托管 bundle](../../bundle/hosted-app/README.zh.md) 在 POSIX 主机上挂载它。

```yaml
- id: subprocess-executor
  name: '@aeven/subprocess-executor'
  config:
    poolSize: 8
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `poolSize` | `4` | 辅助进程保持就绪的空闲启动器数量；超出它的突发请求退回普通 spawn |

生成的 [配置目录](../../../docs/config-catalog.zh.md#aevensubprocess-executor) 是每个可接受字段及其 JSDoc 的完整来源。

### 命令有何不同

通过启动器启动的命令，其 pid、进程组、stdio、退出状态和信号与本地运行时 spawn 的命令相同。其 `argv[0]` 是程序解析后的绝对路径。带有继承流、程序不可执行或工作目录不存在的调用会退回普通 spawn，因此其失败就是通常的 spawn 错误。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：启动一次辅助进程，并把池化的 spawner 装入本地运行时 |
| [`src/executor.ts`](src/executor.ts) | Host 端：交接来的启动器池、形似 ChildProcess 的代理以及回退 |
| [`src/worker.ts`](src/worker.ts) | 辅助进程，打包为 `lib/worker.cjs` |
| — | 不发布运行时不变量伴随包；本运行时沿用本地运行时的进程所有权，不增加可被第二次观察推翻的事件序列。 |

### 一条命令

辅助进程把每个启动器作为 detached 的 `bash` 启动，它阻塞在从描述符 3 读取脚本上；辅助进程通过 IPC 把它的 stdin、stdout、stderr 和控制管道作为打开的描述符交给 Host，然后报告其 pid。启动命令时，Host 取一个就绪的启动器，把 `cd -- <cwd> && exec /usr/bin/env -i <environment> <program> <args>` 写入控制管道并关闭它；启动器随即成为该命令。输出通过交接来的管道直接流入 Host 的收集器。辅助进程作为启动器的父进程报告其退出状态；信号和进程树终止仍像以前一样由 Host 发往进程组。

### 结束

Host 销毁运行时时，辅助进程杀掉无人取用的启动器并退出；当 Host 未关闭通道就死亡时，辅助进程会因被重新指定父进程而察觉，并同样退出。若辅助进程在命令运行时结束，则每条命令在其进程组消失后报告为被杀死，记录一条警告并启动新的辅助进程；一分钟内结束五次后，运行时记录它放弃，此后每条命令都以普通 spawn 启动。在辅助进程得知 Host 已取走之前就结束的启动器，会随其移除一起报告退出状态，因此该命令仍会结束。辅助进程的错误（例如 spawn 失败或通道断开）视同辅助进程结束；已被替换的辅助进程仍在投递的消息连同其描述符一起被丢弃；辅助进程已结束的命令在其进程组消失一秒后关闭其流。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [本地子进程运行时](../subprocess-local/README.zh.md) — 本运行时继承的进程所有权与拆除。
- [执行器 Agent Note](../../../.agents/notes/implemented/feature/2026-11-06-subprocess-executor.zh.md) — 为什么 Host 不能为每条命令 fork，以及进程池如何让 pid 保持同步可得。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本运行时改变的是进程的启动方式，而不是任何工具的返回内容。

#### KV Cache 影响

不会直接使 KV Cache 失效；它不向请求贡献任何内容。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限 POSIX** — 它需要 `bash`、`/usr/bin/env` 和进程组；Windows 主机保留本地运行时。
- **空闲启动器各占几 MB** — 每个都是一个等待中的 `bash`。
- **终端仍从 Host 启动** — `spawnTerminal` 通过本地运行时分配 PTY。
- **运行中的命令随辅助进程结束** — 监狱中的命令以 `--die-with-parent` 运行，其父进程是辅助进程，因此崩溃的辅助进程会在新辅助进程接手之前带走其正在运行的命令。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：未决方向与开放问题。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

无。

</details>
