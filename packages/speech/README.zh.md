---
description: "speech 包组：ctx.speechToText 识别器注册表、浏览器调用的 speech Remote，以及本地 Whisper 提供方。"
kind: "package-group"
---

# speech/ — 语音转文本

[English](README.md) | 中文

## 概述

speech 组把浏览器中录下的语音转成文本，转写发生在 Aeven 所在机器上，不把音频发送给厂商。`ctx.speechToText` 持有具名识别器，在调用前解析出一个，并且只运行那一个，因此没有任何回退会把音频送往别处。三个包分担该家族：持有选择、就绪与取消的 Service Definition；把浏览器录音接到它的 `speech` Remote；以及在受管 worker 中运行 whisper.cpp 的本地 Whisper 提供方。这里没有面向模型的内容：一次转录既不会激活 agent，也不会向 agent 提交。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

Service Definition 持有选择与取消；另外两个包把浏览器录音接到它，并注册负责应答的识别器。

| 包 | 职责 |
|---|---|
| [`speech-to-text/`](speech-to-text/README.zh.md) | 持有 `ctx.speechToText`：具名识别器注册、显式的先解析后转录、就绪与取消 |
| [`api-speech-to-text/`](api-speech-to-text/README.zh.md) | 向浏览器暴露 `speech` Remote：提供方发现、准备，以及一次完整录音的转录 |
| [`speech-to-text-whisper/`](speech-to-text-whisper/README.zh.md) | 注册本地 Whisper 识别器：受管的 whisper.cpp worker、按需校验的模型，以及各界面显示的准备状态 |

<a id="related-documentation"></a>
## 相关文档

- [语音转文本子系统](../../docs/subsystems/speech.zh.md)——`ctx.speechToText` 与 `ctx.speechController` 的各项操作、提供方就绪与选择。
- [生成的配置目录](../../docs/config-catalog.zh.md#aevenspeech-to-text-whisper)——本地提供方接受的模型来源、空闲超时与等待上限。
- [能力 seam](../../docs/glossary.zh.md#capability-seam)——本组所依据的 Service Definition、Service Provider 与 Consumer 角色。

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

无。
