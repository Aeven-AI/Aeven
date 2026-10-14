---
description: "主机上的本地 Whisper 转写：受管的 whisper.cpp 工作进程、按需下载并校验的模型，以及语音界面展示的准备状态。"
kind: "package-reference"
---

# @aeven/speech-to-text-whisper

[English](README.md) | 中文

## 概述

`@aeven/speech-to-text-whisper` 以 `providerId`（默认 `whisper-local`）在 `ctx.speechToText` 上注册本地识别器。whisper.cpp 运行在受管的子进程工作进程中，一次接收一段解码后的 WAV，并返回其文本。插件激活时会检视磁盘缓存，并在不下载、不加载模型的情况下报告就绪状态；一次准备会从配置的来源下载模型与 Silero VAD 文件，逐项按 SHA-256 校验，然后启动工作进程。同一个串行工作进程服务每一次录制，`maxPending` 限定可排队等待的数量，空闲的工作进程在 `idleTimeoutMs` 之后停止。

## 目录

- [使用此包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用此包

在带有 `speechToText` 席位的 Host 组合中挂载它。`dataRoot` 是存放已校验模型的绝对目录；`modelPath`、`vadModelPath` 与 `workerPath` 改为指向已存在的文件，否则默认使用下载而来的模型与平台包预构建的工作进程。`modelOrigins` 列出每次下载前会比较的 Hugging Face 兼容来源，设置 `modelOrigin` 则固定单一来源并去掉公共回退。本包自己的 spec 覆盖下载与完整性路径、来源竞速以及下载诊断。

<a id="model-experience"></a>
## 模型体验

### 本地转写

#### 模型看到什么

本包不向模型提供任何内容：它不注册工具，也不写入提示词文本。向 `ctx.speechToText` 索取转写的消费者决定哪些文本到达模型，准备状态（`phase`、`steps`、`download`）则经注册表到达产品界面。

#### Token 影响

本身无影响；转写只在消费者构造的结果里消耗 token。

#### KV Cache 影响

无；本包不贡献请求期文本。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为下载、完整性与来源竞速的关系已由本包自己的 spec 断言，其余状态是它发布到 `ctx.speechToText` 的准备阶段，伴随模块只能从它所观测的服务里读回。
- **首次准备需要可访问的来源**——省略 `modelPath` 与 `vadModelPath` 时，模型与 VAD 文件在准备阶段下载，因此离线部署必须预先放置这两个文件。

<a id="dev-note"></a>
### 开发备注

无。
