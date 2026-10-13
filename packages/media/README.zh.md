---
description: "media 包组：ctx.media 生成图像与生成视频 seam，以及为其服务的 Aeven、DeepInfra、OpenRouter 与 pi-ai 提供方。"
kind: "package-group"
---

# media/ — 生成图像与视频

[English](README.md) | 中文

## 概述

media 组让一套组合通过统一的 `ctx.media` 服务从 prompt 生成图像与视频片段，因此无论由哪个厂商作答，调用方请求一张图片或一段片段的方式都相同。挂载该 seam 以及一个或多个提供方包后，调用方按名称选择提供方，并原样传入该提供方自己的 model id。图像直接返回字节；视频始终是一个任务，由调用方启动、轮询，然后取回。该 seam 不注册任何工具，也不注册任何面向模型的内容——模型看到什么由 Consumer 负责。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

seam 包持有服务与提供方注册表；每个提供方包把某一个厂商的图像或视频能力注册进去。

| 包 | 职责 |
|---|---|
| [`media`](media/README.zh.md) | 持有 `ctx.media` 以及所有提供方注册进入的图像与视频提供方注册表 |
| [`media-aeven`](media-aeven/README.zh.md) | 通过已登录会话从 Aeven 网关提供 Aeven 的两个图片模型 |
| [`media-deepinfra`](media-deepinfra/README.zh.md) | 通过 DeepInfra 的 OpenAI 兼容端点提供图像与视频 |
| [`media-openrouter`](media-openrouter/README.zh.md) | 通过提交、轮询与内容取回从 OpenRouter 提供视频 |
| [`media-pi-ai`](media-pi-ai/README.zh.md) | 通过把 pi-ai 自己的 images 注册表注册为提供方来提供图像 |

<a id="related-documentation"></a>
## 相关文档

- [生成媒体子系统](../../docs/subsystems/media.zh.md)——该 seam 的词汇、图像与视频请求形态，以及为什么一个能力同时覆盖两种媒体。
- [能力 seam](../../docs/glossary.zh.md#capability-seam)——本组所依据的 Service Definition、Service Provider 与 Consumer 角色。
- [生成的配置目录](../../docs/config-catalog.zh.md)——该 seam 及其提供方接受的每个配置字段。

<a id="dev-note"></a>
## 开发备注

无。
