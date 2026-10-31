---
description: "具名语音合成提供方，以及从语言到语音的解析。"
kind: "package-reference"
---

# @aeven/text-to-speech

[English](README.md) | 中文

## 概述

该 Service Definition 通过 `ctx.textToSpeech` 把文本转换为语音音频。消费方在执行之前先解析一个请求（文本加上一种语言或一个确切的语音）；提供方注册自己的语音与传输通道。

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

通过 [avn-web-app 组合包](../../bundle/web-app/README.zh.md) 加载，或把该服务与一个提供方、一个消费方组合起来。`voiceByLanguage` 为每个主语言子标签（`en`、`nl`、`es`、`zh`）固定一个语音 id；它未固定的语言改由已注册的目录解析——先取该语言的母语地区，再取该语言的任意语音，最后取多语言语音。提供方缺失或重复，或两个提供方都声称拥有同一个语音 id，都会在注册时失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

`resolve()` 把请求映射到一个已注册的语音并捕获它的提供方；`synthesize()` 会拒绝已撤回或已被替换的注册，并在调用方的 signal 与注册的生命周期两者之下运行。注册的 disposer 会关闭准入、中止已接受的请求，并等待提供方结算；提供方以各自的容器格式返回编码后的音频，此处不会重新编码，也不会回退到另一个提供方。

不发布运行时 invariant 伴随模块：注册表是名册与映射观测的唯一来源。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音合成子系统](../../../docs/subsystems/speech.zh.md)

-----

<a id="dev-note"></a>
## 开发备注

一种语言的默认语音是女声，因为名册在若干层级上都提供比女声更多的男声，而简单的首个匹配会落在男声上：Edge 名册把一条日语男声排在 `ja-JP-NanamiNeural` 之前，并为 `zh` 语族列出一条粤语语音。因此解析在每一层级都优先选择女声——该语言的母语地区、确切语言、语族，然后是多语言语音——只有在提供方没有该语言的女声时才退回到男声。`dominantLocale()` 统计名册，而不是信任列出的第一个语言环境，这正是让 `zh` 停留在普通话上的原因。

目录携带提供方报告的音色，而不是从语音 id 推断：像 `zh-CN-XiaoxiaoNeural` 这样的名字并不编码性别，而省略 `gender` 的配置行会保留发现阶段对同一 id 报告的内容。

不发布运行时 invariant 伴随模块：注册表是名册与映射观测的唯一来源。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 `avn-tool-read-aloud` 以及调用它的 Web 朗读器。

#### KV Cache 影响

合成渲染的是模型已经产出的文本，不向请求增加任何 token，因此前缀复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 该服务不持久化语音偏好；表层目前只读取组合中的映射。语速、音高以及按请求的韵律都不属于请求的一部分。
