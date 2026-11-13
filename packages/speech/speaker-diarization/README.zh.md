---
description: "本地说话人分离：把一段录音切分为每段只有一个声音的片段，并为每段计算声纹，使用按需下载并校验的 pyannote 与 WeSpeaker 模型，经 sherpa-onnx 运行。"
kind: "package-reference"
---

# @aeven/speaker-diarization

[English](README.md) | 中文

## 概述

`ctx.speakerDiarization` 为录音机区分不同的声音。`segment` 把一段录音切分为首尾相接、每段只有一个声音的片段，并为每个足够长、结果可信的片段给出单位长度的声纹向量，调用方据此在同一场会议的多段录音之间认出同一个声音。模型——pyannote segmentation 3.0 与 WeSpeaker ResNet34 声纹模型，合计 32.5 MB——在 `prepare` 时下载到 `dataRoot`，并按 `runtime/assets.json` 校验大小与 SHA-256。推理在一个 worker 线程中通过 sherpa-onnx 的 Node-API 插件运行，因此不会阻塞宿主的事件循环。宿主平台没有 sherpa-onnx 构建时，服务报告 `unavailable` 而不是失败。

## 目录

- [使用本包](#use-this-package)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

以绝对路径 `dataRoot` 编排本插件。激活时只检查缓存，不下载；`snapshot` 与 `follow` 报告 `unavailable`、`unprepared`（附带下载总大小）、`checking`、`downloading`（两个文件合计的字节数）、`ready` 或 `failed`。`prepare` 下载并校验缺失的文件，已有准备任务时并入该任务。`segment(samples, signal)` 接收取值在 [-1, 1] 的 16 kHz 单声道采样，按顺序返回 `{ start, end, embedding? }` 片段；模型就绪前会拒绝请求。`clusteringThreshold` 是同一段录音中两个片段被归为同一说话人的余弦距离上限，`minDurationOn` 与 `minDurationOff` 决定片段的形状，`minEmbeddingSeconds` 把更短的片段并入相邻片段，`threads` 设置每个模型的 CPU 线程数。

-----

<a id="further-exploration"></a>
## 延伸阅读

- [api-speech-to-text](../api-speech-to-text/README.zh.md) —— 把本服务暴露给浏览器的 `speech` Remote 方法。
- [ui-sidebar-meeting](../../client/ui-sidebar-meeting/README.zh.md) —— 录音机，它在整场会议中匹配这些声纹。

-----

<a id="model-experience"></a>
## 模型体验

无，因为它只经 speech Remote 为录音机按声音切分录音，不注册任何提示词、工具或会话事件。

#### KV 缓存影响

无；本包既不组装也不发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **无不变式伴生入口** —— 不发布不变式伴生入口，因为服务只拥有一个状态值和一个 worker，所有观察者都通过 `snapshot` 或 `follow` 读取同一个状态，不存在可与之背离的第二份观察。
- **Windows on ARM 没有运行时** —— sherpa-onnx 没有为它发布构建，因此服务在那里报告 `unavailable`，录音机不会标注说话人。
- **只在一场座谈上调过参** —— `clusteringThreshold` 设为 0.3 时能把一场四人座谈区分开，而 sherpa-onnx 默认的 0.5 会把其中两位说话人合并；其他场景可能需要不同的值。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 —— 点击展开</summary>

worker 以 `eval: true` 从源码运行，并从主线程解析出的绝对路径加载插件，因此打包后的宿主不需要第二个入口文件。

</details>
