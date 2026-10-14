---
description: "输入框听写：把语音录入草稿的麦克风控件，含实时波形，以及准备识别器的 Settings 语音分区。"
kind: "package-reference"
---

# @aeven/client-ui-voice-input

[English](README.md) | 中文

## 概述

听写把输入框的麦克风变成录音器：控制行变为计时器与波形，麦克风信号先经滤波，再由 AudioWorklet 语音检测器切成帧并只保留语音，随后把转写文本追加到草稿。静音永远不会离开浏览器，送出的是单个规范 PCM16 WAV。Settings → Voice 负责准备并报告识别器模型，应用菜单中的听写命令通过同一个输入框控件开始录音。录音需要已准备好的识别器：该控件会把读者送到那个分区，而不是就地开始下载。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Web 客户端的输入框需要接受听写时编排本插件。它需要 `remote`、`remote.speech`、`slots` 与 `locale`。`apply` 在插件 fiber 的 effect 中注册输入框控件、Settings 语音分区与字典，并由一条重连的就绪镜像为界面的每一处跟随 `speech.follow`，因此麦克风与该设置分区对识别器的判断一致。控件用录制音频与所选提供方调用 `speech.transcribe`；设置分区调用 `speech.prepare` 并展示其报告的准备工作阶段。

-----

<a id="further-exploration"></a>
## 延伸阅读

当听写自身契约不足以说明问题时阅读这些：它所扩展的输入框，以及它加入的设置界面。

- [ui-conversation](../ui-conversation/README.zh.md) —— 听写占据其控制行的输入框。
- [ui-settings](../ui-settings/README.zh.md) —— 语音分区加入的设置域。

-----

<a id="model-experience"></a>
## 模型体验

Indirectly, through the conversation composer's draft: a transcript this plugin appends becomes the user message the model reads, so dictated words reach a request only once the user submits them.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求，它插入的只是普通的用户消息文本。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定听写保留什么、把什么留给宿主。

- **无不变式伴生入口**——不发布不变式伴生入口，因为本插件只拥有每次录音的一份采集、一条由宿主语音流供给的就绪镜像，以及 effect 作用域内的注册；它们各自在录音结束或插件 fiber 结束时释放，且没有第二个权威观察同一份采集。
- **只保留语音**——低于检测阈值的帧会被丢弃，因此比阈值更轻的段落可能丢失，完全没有语音的录音不会产生任何内容。
- **转写文本就是普通草稿文本**——可以像键入的文字一样编辑或删除，消息中不记录哪些词来自听写。
- **转写失败只报告不重试**——麦克风显示宿主的消息，录音被丢弃。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
