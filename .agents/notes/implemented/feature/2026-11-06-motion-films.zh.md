# Agent Note：由 HTML 合成渲染的动态影片

Status: implemented

[English](2026-11-06-motion-films.md) | 中文

## 问题

人们会让 Aeven 制作动画讲解、发布视频、动态图表与片头字卡。生成式视频模型无法稳定地保持准确的文字、数字或品牌自己的标志，而且按片收费。技能目录中的 OpenDesign 动态技能已经讲授了这门手艺，但它们指向 OpenDesign 自己的渲染守护进程，而 Aeven 并不运行它，因此在 Aeven 中照做的模型产不出影片。

## 决定

[`motion/`](../../../../packages/motion/README.zh.md) 包组把模型在工作区写下的合成渲染为对话中可播放的 MP4：

- **`@aeven/motion`** 拥有 `ctx.motion`：在唯一注册的渲染器上先 `resolve()` 再 `render()`。
- **`@aeven/motion-hyperframes`** 使用 HyperFrames（Apache-2.0）渲染。HyperFrames 在无头 Chromium 中逐帧定位已暂停的 GSAP 时间线，因此渲染结果是确定的。
- **`@aeven/tool-motion`** 注册 `render_motion` 与运行时 `motion` 技能。技能讲授合成规则以及“编写、渲染、审阅”的循环；草稿渲染会返回静帧，模型先检查它们，再进行交付渲染。

选择 HyperFrames 而非 Remotion 或 Aeven 自写的截帧循环。它的合成格式是普通的 HTML 加 GSAP，模型已经擅长书写。它的渲染器是一个 npm 包（`@hyperframes/producer`），可在进程内运行，并接受显式的浏览器路径。Remotion 的许可证限制较大公司的商业使用。

影片是实时预览的，而不是每次修改都渲染。`show_motion` 把合成文件夹交给 Imagine 的 Motion 卡片。`@aeven/api-motion` 用 HyperFrames 的 `bundleToSingleHtml` 把文件夹打包成单一文档，卡片在 HyperFrames 播放器中播放它，使用与生成视频片段相同的 `MediaPlayer` 控件；播放器的 frame 去掉了 `allow-same-origin`，因此模型编写的脚本在不透明源中运行，与已认证的应用隔离。保存菜单的那一行负责导出：Host 以高质量把文件夹渲染为 `renders/<folder>.mp4`，浏览器下载它。`render_motion` 保留给用户向模型索要文件的情形，模型自身的审阅使用一次性草稿渲染产出的静帧。

只有桌面 Host 挂载该服务、渲染器与这些路由：它们需要本地 Chromium、随附的 ffmpeg，以及位于 Host 本地磁盘上的工作区。会话侧工具会等待 `ctx.motion`，因此共享的 `aeven` 预设携带它，而托管会话永远看不到它。

### 随附 ffmpeg 的变化

[随附的 ffmpeg](../architecture/2026-10-18-desktop-bundles-ffmpeg.zh.md) 不含任何 GPL 代码，因此没有 HyperFrames 默认使用的 libx264。以下四项构建变更让 H.264 渲染在所有桌面平台上可用：

- **`lavfi` 输入。** HyperFrames 用 `-f lavfi` 源测试硬件编码器，并用它混入静音音频。构建只启用 `lavfi` 这一个输入设备，采集设备仍被排除。
- **随附 ffprobe。** HyperFrames 用它校验每个编码出的文件并检查合成中的媒体。这推翻了随附说明中“只随附 ffmpeg”的选择，在 macOS 上的代价约为 21 MB 安装体积。
- **Windows 上的 Media Foundation。** ffmpeg 9 只在编码器打开时才加载 `mfplat.dll`，因此 `ffmpeg.exe` 在 N 版上仍能启动。这推翻了随附说明中关闭它的理由。
- **Linux 上的 OpenH264。** OpenH264 2.6.0（BSD-2-Clause）由固定源码静态编译，覆盖没有 VAAPI 驱动的 Linux 机器。

HyperFrames 只在使用它认识的硬件编码器时才直接写出 MP4。使用 Media Foundation 或 OpenH264 时，渲染器先写出 ProRes 4:2:2 中间文件，再用第一个能编码测试帧的编码器重新编码。这无需修改 HyperFrames。

## 考虑过的替代方案

**安装 OpenDesign 守护进程或 HyperFrames CLI。** 它们是各自带有遥测与项目模型的独立进程。producer 库在 Host 内即可给出相同的渲染结果。

**生成式视频模型。** 它们已作为 `generate_video` 存在；服务的是不同的请求，且无法绘制准确的文字或数据。

**随附 libx264。** 它是 GPL，会改变随附可执行文件的许可。

**修补 HyperFrames 使其认识 `h264_mf` 与 `libopenh264`。** 这能省去第二次编码，但对其编码器参数表的修补在每次升级时都需要重新应用。

## 影响

桌面安装包会增加 ffprobe 可执行文件，以及 HyperFrames producer 及其依赖。在 macOS 与 Linux 上，没有安装 Chromium 的机器会在首次渲染时下载 Chrome for Testing 的无头外壳；Linux arm64 没有这种构建，需要已安装的 Chromium。由源码编译的 OpenH264 不附带 Cisco 的专利许可；Aeven 依赖 AVC 专利池对编码器的免版税额度。Windows N 版需要 Media Feature Pack 才能渲染。渲染器在 Host 进程中一次只渲染一部影片。

## 验证

在 macOS arm64 上通过 `ctx.motion` 渲染，约 15 秒经由 VideoToolbox 写出一部 20 秒 1080p30 的 H.264 MP4，并附带静帧。HyperFrames 使用随附的 macOS ffmpeg 写出 ProRes 4:2:2 中间文件。linux-arm64 构建把 OpenH264 与 VAAPI 编入 ffmpeg，并在旁边产出 ffprobe；可执行文件的共享库因此多出 `libstdc++`。在没有 VAAPI 设备的虚拟机上，探测选中 `libopenh264`，并把带 AAC 音频的 ProRes 中间文件重新编码为 Constrained Baseline 的 H.264 MP4。Windows 目标只在其 CI runner 上构建。
