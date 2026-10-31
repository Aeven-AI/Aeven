---
description: "面向浏览器客户端、经过认证的语音合成 Remote。"
kind: "package-reference"
---

# @aeven/api-text-to-speech

[English](README.md) | 中文

## 概述

该 Remote 向客户端暴露 `tts` 命名空间：语音目录与按句合成，并把调用方的取消一路传递到提供方。

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

与它所前置的服务以及一个 Typert 网关一起加载。`catalog()` 列出语音与语言映射；`synthesize({ text, language })` 返回 base64 编码的音频以及产生该音频的语音。`maxTextChars` 限定单次朗读的文本长度，更长的文本会在调用任何提供方之前被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

合成从不创建会话事件：朗读使用的是会话已经记录下来的文本。客户端的 abort signal 会到达提供方，因此被停止的朗读器不再为它不会播放的音频付出代价。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音合成子系统](../../../docs/subsystems/speech.zh.md)

-----

<a id="dev-note"></a>
## 开发备注

控制器通过 `tts` Remote 命名空间暴露该 seam，且自身不持有状态：它承载的任何内容都不可见于模型，因此它不记录会话事件，回放也就无法与实时运行产生分歧。`maxTextChars` 限定单次请求的长度，因为表层在请求之前会先把回复分段；更长的请求体会在触及提供方之前被拒绝。

取消就是调用方给出的 signal，它被直接透传到合成，因此中途停止会中止提供方请求，而不是缓冲没人会听的音频。

不发布运行时 invariant 伴随模块：控制器在调用之间不持有状态，答案都来自已注册的提供方，因此不存在可供比较的第二份观测。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该 Remote 不承载任何对模型可见的输入或输出。

#### KV Cache 影响

没有任何 token 经过该 seam，因此不影响提供方的缓存复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 一次请求只合成一句话长度的文本；更长的段落如何切分由调用方决定。
