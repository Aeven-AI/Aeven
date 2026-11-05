---
description: "Aeven 云端语音识别提供方：通过 API 的 /transcribe 路由转写，使用每个登录用户自己的 Aeven 会话。"
kind: "package-reference"
---

# @aeven/speech-to-text-aeven

[English](README.md) | 中文

## 概述

`@aeven/speech-to-text-aeven` 是语音转文字能力的提供方：把每段录音发送到 Aeven 的 API 并返回转写结果。请求携带说话者本人的 Aeven 会话，因此服务多个账号的 Host 不会把一个人的语音计费或归属到另一个人，Host 自身也不加载任何识别模型。凡是部署能访问 Aeven API 的地方都可以选它；本地识别是另一个提供方。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

bundle 行给出 `providerId`、API 源站、保存登录用户会话的凭据引用、愿意发送的最大录音（`maxAudioBytes`）以及单次请求的截止时间。消费者按 id 选择提供方；超过上限的录音在上传前就被拒绝，错过截止时间的请求整体失败而不是只转写一半。

<a id="understand-the-implementation"></a>
## 理解实现

提供方通过凭据服务解析调用者的 Aeven 会话，把录音 POST 到 API 的 `/transcribe` 路由，再把响应映射为能力的 `Transcript`。拒绝与超时按提供方自己的错误抛出；调用方背后没有任何缓存或重试。

<a id="further-exploration"></a>
## 进一步探索

- [语音转文字能力](../../speech/speech-to-text/README.zh.md)
- [托管 bundle](../../bundle/hosted-app/README.zh.md)

<a id="model-experience"></a>
## 模型体验

间接地：只有把转写放进自己消息或提示词的消费者才让它进入请求；本包不增加自己的提示词段落或工具，因此消费者按普通输入为听写文本付费。

#### KV Cache 影响

无；该包既不组装也不发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅云端**——无法访问 Aeven API 时提供方失败；既没有离线路径，也不内置模型。
- **一次一段录音**——没有流式片段、没有说话人分离、没有说话人标签。
- **计费跟随调用者的会话**——无法解析登录会话的 Host 就不能转写，这是有意为之。


### 开发备注

不发布 invariant 伴随模块：提供方的契约属于该能力本身，其自身行为由测试覆盖而不是不变量。
