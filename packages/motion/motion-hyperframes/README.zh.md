---
description: "ctx.motion 的 HyperFrames 渲染器：在 macOS、Windows 与 Linux 上用 Chromium 截帧，并通过随附的 LGPL ffmpeg 编码 H.264 MP4。"
kind: "package-reference"
---

# @aeven/motion-hyperframes

[English](README.md) | 中文

## 概述

该提供方把 [HyperFrames](https://github.com/heygen-com/hyperframes)（Apache-2.0）注册为动态影片渲染器。HyperFrames 在无头 Chromium 中加载合成，逐帧定位其已暂停的 GSAP 时间线，并用 ffmpeg 编码这些帧，因此同一组文件每次渲染的结果都相同。编码使用 Aeven 构建的 ffmpeg 与 ffprobe，它们不含任何 GPL 代码，因此 H.264 来自各平台自身提供的编码器。其 `bundle()` 即内联运行时的 HyperFrames `bundleToSingleHtml`。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

在 [`avn-motion`](../motion/README.zh.md) 之后挂载。`browserCacheDir` 为必填项：下载的无头 Chromium 保存在这里。桌面 Host 把它设在 Aeven 主目录下。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `ffmpegPath`、`ffprobePath` | 随附的 `@aeven/ffmpeg-<platform>-<arch>` 可执行文件 | 编码器与探测器；缺少可执行文件会让插件在加载时失败 |
| `browserPath` | 已安装的 Chrome、Chromium、Edge 或 Brave，否则为下载的无头外壳 | 用于截帧的 Chromium 可执行文件 |
| `fallbackEncoders` | `h264_mf`、`libopenh264` | HyperFrames 找不到硬件编码器时依次尝试的 H.264 编码器 |
| `intermediateProfile` | `422` | 回退编码器所读取中间文件的 ProRes 档次 |
| `fallbackBitrate` | `6M` / `12M` / `20M` | `draft` / `standard` / `high` 的回退视频码率 |
| `stillWidth` | `960` | 返回静帧的像素宽度 |

各平台的编码器：

- **macOS：** VideoToolbox。
- **Windows：** Media Foundation，经由回退路径。
- **Linux：** GPU 驱动提供 VAAPI 时使用它；否则使用 OpenH264，经由回退路径。

-----

<a id="understand-the-implementation"></a>
## 理解实现

插件在加载期间为 Host 进程设置 `HYPERFRAMES_FFMPEG_PATH` 与 `HYPERFRAMES_FFPROBE_PATH`，因为 HyperFrames 只从这两个变量读取其可执行文件；卸载时恢复原值。

首次渲染时，它选定浏览器与编码路径，成功后会复用二者：

- **浏览器：** 配置的路径；否则是平台固定位置上第一个已安装的浏览器；否则是 Chrome for Testing 的无头外壳，版本取 producer 所用 Puppeteer 固定的构建，下载到 `browserCacheDir`。
- **直接路径：** HyperFrames 自己的探测找到硬件编码器时，用该编码器写出 MP4。
- **回退路径：** 否则先在临时文件夹中渲染 ProRes `.mov`，再由第一个能编码测试帧的回退编码器把它重新编码为 H.264，并复制 AAC 音频。

随后 ffprobe 读取影片的时长与尺寸，ffmpeg 取出请求的静帧。渲染一次只运行一个；每次渲染本身已用满所有核心。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 [`avn-tool-motion`](../tool-motion/README.zh.md)，它把渲染器失败（如 HyperFrames 拒绝某个合成，或没有可用的编码器）作为其错误文本报告。

#### KV Cache 影响

渲染器只写文件，不向请求追加任何内容，因此前缀复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无不变量伴随包** — 不发布不变量伴随包：渲染器只持有记忆化的查找结果，没有第二个观察者会报告它们。
- **Linux arm64 需要已安装的 Chromium** — Chrome for Testing 不发布可下载的 Linux arm64 构建。
- **回退路径会编码两次** — 默认档次下 ProRes 中间文件在视觉上无损，但 1080p30 每秒约需 3.5 MB 临时空间，并多出一次编码。
- **未安装 Media Feature Pack 的 Windows N 版无法渲染** — ffmpeg 只在 Media Foundation 编码器打开时才加载 `mfplat.dll`，因此能够启动，但找不到编码器。
- **没有 NVENC、QSV 或 AMF** — 随附的 ffmpeg 未编入任何厂商 GPU 编码器，因此 Windows 总是走回退路径。

<a id="dev-note"></a>
### 开发备注

无。
