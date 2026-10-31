---
description: "语音合成服务使用的 Microsoft Edge 朗读语音。"
kind: "package-reference"
---

# @aeven/text-to-speech-edge

[English](README.md) | 中文

## 概述

该提供方通过 Microsoft 的 Edge 朗读服务发声，每个语音一条 WebSocket。启动时它会向 Edge 询问所配置语言环境中的全部语音，因此目录跟随服务本身，而不是一份重述的清单；配置中列出的语音则作为部署所保证的条目加入其中。

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

与 [`@aeven/text-to-speech`](../text-to-speech/README.zh.md) 一起加载。`voices` 列出该部署所保证的语音 id 及其显示名与主要语言；合成映射引用这些 id。`locales` 指定其语音在启动时加入目录的 Edge 语言环境，空列表则取 Edge 发布的每一个语言环境；无法访问语音服务时，配置中的列表就是整个目录。`timeoutMs` 限定单次请求的时长。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节——点击展开</summary>

对某个语音的首次请求会在 `src/edge-tts.ts` 中打开一个 `MsEdgeTTS` 客户端；后续请求复用它，因此连续的句子不必再次支付握手。取消会拒绝挂起的合成并让该客户端保持打开，因为在句子中途停止后连接仍然健康，否则下一次朗读又要重新握手；自身失败的合成会释放该客户端，下一次请求再把它重新打开。销毁会关闭所有已打开的客户端。

音频是 24 kHz 单声道 MP3，浏览器用 `decodeAudioData` 解码。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[语音合成子系统](../../../docs/subsystems/speech.zh.md)

-----

<a id="dev-note"></a>
## 开发备注

每个语音 id 由一个 `MsEdgeTTS` 实例服务并保持缓存。该客户端每个实例打开一条 WebSocket，因此若每次请求都创建一个，就会为每个分句支付一次握手。只有自身失败的合成才会释放缓存的实例，下一次尝试会重新连接，而不是复用已关闭的载体；调用方的取消会保留它，而被放弃的轮次其帧会被忽略，因为每个轮次都带有自己的请求 id。

语音的 `Gender` 从提供方自己的语音列表读取，并且是该事实的唯一来源：id 与显示名都不编码音色，而多语言语音不落在任何单一语言的名册之内。

不发布运行时 invariant 伴随模块：发现与合成是仅有的两种观测，两者都直接回报给调用方。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 `avn-text-to-speech`，由它拥有自己合成的那个请求。

#### KV Cache 影响

该提供方为模型已经产出的文本返回音频，不向请求追加任何内容，因此已有的前缀仍然可复用。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 合成需要向 Microsoft 的服务发起出站网络访问；目前还没有音质相当的离线提供方。`src/edge-tts.ts` 是 Aeven 对该非官方服务自己的客户端，因此协议变更会以服务中断的形式到达我们这里，而不是以上游发版的形式：它对接 `api.msedgeservices.com` 说 Edge 朗读的 WebSocket 协议，并在旧版 `speech.platform.bing.com` 主机上列出语音，那是唯一会应答语音列表的主机。
