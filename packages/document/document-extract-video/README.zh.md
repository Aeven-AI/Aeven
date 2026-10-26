---
description: "视频读取器：声明录制或上传的片段，并报告本部署已知的时长、画面尺寸、编码、容器与大小。"
kind: "package-reference"
---

# @aeven/document-extract-video

[English](README.md) | 中文

## 概述

`@aeven/document-extract-video` 在 `ctx.documentExtract` 上以优先级 10 注册 `video` provider，于是上传或相机录制的片段（`mp4`、`m4v`、`mov`、`webm`、`mp3`）成为一个可用的文件附件，而不是不支持的类型。MP3 上传使用音频流，报告音频元数据，不声称已转录内容。读取器用宿主机自带的 `ffprobe` 探测片段，并存储一句描述；画面与声音从不转录，因此这句话会明确说明这一点。

## 目录

- [使用本包](#use-this-package)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

<a id="use-this-package"></a>
## 使用本包

把它挂在 service 旁边：插件在 `ctx.documentExtract` 上注册 `video` provider。此后 composer 的文件输入会接受视频与 MP3，因为 `documentExtract.accepted()` 已包含该 provider 的格式。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `ffprobePath` | `ffprobe` | 探测可执行文件，除非给出文件路径，否则经 `PATH` 解析 |
| `probeTimeoutMs` | `15000` | 单次探测的墙钟上限；超时则退回文件事实 |

没有可用的 `ffprobe` 时，读取器仍声明这些格式，只报告容器与字节大小，于是在没有该二进制的部署中片段仍能附上，而不是被拒绝。

<a id="dev-note"></a>
## 开发备注

本包不发布运行时不变式伴随模块：它能断言的关系——已注册的格式也必然可抽取——已由 registry 自身的路由强制执行，伴随模块只会把它再说一遍。

### 验证

`tests/extract.spec.ts` 固定了声明集合、探测得到的那句话、两条退路（没有二进制、回答不可用）、只给出编码的流、未知容器的标签、取消，以及 fiber 释放后格式一并撤回。

<a id="model-experience"></a>
## 模型体验

### 片段即一行文本

#### 模型看到的内容

上传的文件以 `<attached_file>` 元素到达模型，其抽取文本是一句话，例如 `Video clip "clip-1755000000000.webm": 8.2 s, 720×1280, vp9, WebM, 3.4 MB. The clip is stored with this session; its frames and sound are not transcribed.` 模型由此知道存在一个片段、它有多长、画面多大，而这句话也明确说明内容本身没有被读取。

#### Token 影响

每个片段一句话，受抽取预算限制。

#### KV Cache 影响

仅追加：该文本随附件存储，因此重放和之后的轮次引用同一句话，无需重新探测。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与暂缓事项

- **没有任何东西在观看片段**——既没有抽帧也没有音频转录，模型只能依据事实推断片段内容。抽帧读取器是自然的下一步，可以复用同一个 `ffprobe` 依赖来选择时间点。
