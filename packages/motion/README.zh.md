---
description: "motion 包组：ctx.motion 影片渲染接缝、其 HyperFrames 渲染器，以及 render_motion 工具与 motion 技能。"
kind: "package-group"
---

# motion/ — 动态影片

[English](README.md) | 中文

## 概述

motion 包组把模型以 HTML 写成的动画渲染为 MP4 影片。模型在会话工作区中编写一个 [HyperFrames](https://github.com/heygen-com/hyperframes) 合成，`show_motion` 展示它：对话以产品自身的视频控件实时播放该合成，用户从影片自己的菜单把它导出为 MP4。这里不生成任何实拍画面：每一帧都由合成绘制，因此文字、数据、标志与用户的图片都严格按写定的方式运动。桌面 Host 挂载 HyperFrames 渲染器，它需要本地 Chromium 与随附的 ffmpeg；托管 Web 挂载预览渲染器，它实时展示影片，不渲染 MP4。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`motion`](motion/README.zh.md) | 拥有 `ctx.motion`：解析渲染请求，并在唯一注册的渲染器上执行 |
| [`motion-hyperframes`](motion-hyperframes/README.zh.md) | 在 Chromium 中用 HyperFrames 渲染合成，并通过随附的 ffmpeg 编码 H.264 |
| [`motion-preview`](motion-preview/README.zh.md) | 为实时播放器打包合成，不渲染影片，供托管 Web 使用 |
| [`tool-motion`](tool-motion/README.zh.md) | 在渲染器存在时注册 `show_motion`、`render_motion` 与 `motion` 技能 |
| [`api-motion`](api-motion/README.zh.md) | 为 Motion 卡片提供实时预览、MP4 导出与影片字节 |

<a id="related-documentation"></a>
## 相关文档

- [动态影片子系统](../../docs/subsystems/motion.zh.md) — 生成的 `ctx.motion` API 参考。
- [能力接缝](../../docs/glossary.zh.md#capability-seam) — 本包组所依据的 Service Definition、Service Provider 与 Consumer 角色。
- [随附 ffmpeg](../../.agents/notes/implemented/architecture/2026-10-18-desktop-bundles-ffmpeg.zh.md) — 渲染器用来编码与探测的仅 LGPL 可执行文件。
- [动态影片决定](../../.agents/notes/implemented/feature/2026-11-06-motion-films.zh.md) — 为何选择 HyperFrames、各平台的编码器，以及仅限桌面的范围。

<a id="dev-note"></a>
## 开发备注

无。
