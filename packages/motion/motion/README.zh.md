---
description: "ctx.motion Service Definition：唯一注册的渲染器把 HTML 动画合成渲染为 MP4 影片。"
kind: "package-reference"
---

# @aeven/motion

[English](README.md) | 中文

## 概述

该 Service Definition 通过 `ctx.motion` 把编写好的动画合成渲染为 H.264 MP4。消费方先把请求（合成文件夹、输出路径，以及可选的帧率、质量、静帧时间、静帧区域与审计时间）解析为 spec，再在唯一注册的渲染器上渲染该 spec，并得到影片的路径、大小、时长、尺寸、编码器、请求的 PNG 静帧，以及所请求审计的发现：对影片文字测得的问题，如被裁切的标题或低于字号下限的文字。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

将它与一个渲染器（如 [`avn-motion-hyperframes`](../motion-hyperframes/README.zh.md)）以及一个消费方（如 [`avn-tool-motion`](../tool-motion/README.zh.md)）一起挂载。`fps`（24、30 或 60；默认 30）与 `quality`（`draft`、`standard` 或 `high`；默认 `standard`）用于补全省略它们的请求。合成路径与输出路径都是本地绝对路径；把它们限制在工作区内是消费方的职责。`audit` 保存判定发现所用的阈值：`typeFloorFraction`（默认为画面短边的 0.026）、`readOpacity`（0.5）、`minHeldSeconds`（0.5）、`minHeldShare`（0.5）、`holdBaseSeconds`（0.5）、`holdPerWordSeconds`（0.3）与 `maxFindings`（20）。字号、不透明度与阅读时间的默认值即 HyperFrames 自身 `check` 命令所用的值。请求可以携带调用会话的 `sandboxPolicy`：在账户沙箱内运行的渲染器需要它，并把每个路径限制在其工作区根内；在 Host 本机运行的渲染器忽略它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

`resolve()` 应用默认值并捕获已注册的渲染器；没有注册渲染器时会抛错。`render()` 会拒绝其渲染器已被撤回或替换的 spec，并同时在调用方的信号与注册的生命周期下运行。`bundle()` 向已注册的渲染器请求把合成打包成一个自包含的 HTML 文档，场景文件、播放器运行时、图片与字体都已内联，因此无需其文件夹即可播放；没有注册渲染器时会抛错。带 `auditTimes` 的请求要求渲染器在这些时间测量影片。渲染器把审计脚本（`withMotionAuditScript`）加入打包文档，在播放它的页面中调用 `window.__avnMotionAudit(times)`，并返回页面的采样；`render()` 按服务的 `audit` 阈值用 `summarizeAudit` 判定它们，因此每个渲染器得出相同的发现。布局问题只有持续 `minHeldSeconds` 且覆盖元素在屏时间的 `minHeldShare` 时才会报告，从而排除入场、出场与场景切换。该脚本是 HyperFrames 的布局审计，原样复制到 [`audit/`](audit/README.zh.md)，另加一个定位影片的驱动脚本。第二次 `register()` 会抛错，且不替换第一个。注册的释放函数会中止已接受的渲染并等待它们结束。

-----

<a id="model-experience"></a>
## 模型体验

间接影响，经由 [`avn-tool-motion`](../tool-motion/README.zh.md)，它负责模型读取的每个 schema、技能与结果。

#### KV Cache 影响

该服务不向请求添加任何内容，因此前缀复用不受影响。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **无不变量伴随包** — 不发布不变量伴随包：该服务只持有一项注册，没有其他观察者能够与之矛盾的状态。
- **仅限文字** — 审计只判定文字：裁切、溢出、重叠、遮挡、字号、不透明度、阅读时间，以及未加载的字体。它不判定对齐、文字相对图片的色彩对比度，也不判定动效。
- **仅限本地路径** — 渲染器从 Host 自身的文件系统读取合成并写出影片，因此工作区位于远程沙箱中的会话无法渲染。

<a id="dev-note"></a>
### 开发备注

无。
