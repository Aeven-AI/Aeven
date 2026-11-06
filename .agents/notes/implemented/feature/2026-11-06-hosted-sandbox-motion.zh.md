# Agent Note: 在托管监狱中渲染动画

Status: implemented

[English](2026-11-06-hosted-sandbox-motion.md) | 中文

## 问题

在桌面端，`tool-motion` 和 `api-motion` 在 Host 启动的 Chromium 中把 GSAP 页面渲染为视频。托管部署关闭了两者，因为该渲染器在 Host 上运行、可访问网络，并写入任何账户文件夹之外的位置，所以托管对话无法生成动画或视频。

## 决策

托管部署把动画渲染作为普通命令在[监狱](2026-11-06-hosted-sandbox-jail.zh.md)中运行。[`host/install-motion.sh`](../../../../packages/sandbox/sandbox-jail/host/install-motion.sh) 向只读镜像加入无头 Chromium（`playwright-core`）、GSAP 和开放许可字体（SIL Open Font License 下的 Google Fonts 字体族，其中包括 Google Sans Flex，以及覆盖所有文字、CJK 和彩色 emoji 的 Noto），并安装 `render-motion`。`render-motion page.html film.mp4` 暂停页面的 GSAP 全局时间线或调用其 `window.seek(seconds)`，逐帧定位并截图，再把帧通过管道送入 ffmpeg；影片上限为 120 秒、60 fps、每边 1920 像素。从 CDN 请求的 GSAP 由已安装的副本响应，其他请求一律失败，因此为网页编写的页面在无网络时仍能运行。托管监狱以只读方式挂载 `/var/cache/fontconfig`，使 Chromium 不必重新扫描字体，并设置 `PLAYWRIGHT_BROWSERS_PATH`；模型说明告诉模型如何制作影片并通过 `output_files` 分享；`avn-tool-bash` 以对应的媒体类型分享 `.mp4`、`.webm`、`.mov`、`.mp3` 和 `.wav` 文件。

## 备选方案

暂不在托管部署中启用经过限制的 `tool-motion`：它的渲染器、预览服务器和存储都假定使用 Host 自己的文件夹，限制它们比复用监狱的改动更大。渲染时获取字体的方案被否决，因为监狱没有网络。

## 影响

监狱的账户限额约束每次渲染：2 个 CPU、2 GiB 内存、256 个进程和 512 MiB 的 `/tmp`。分享的影片在对话中显示为文件，打开后播放，而不是在工具卡片中内联播放。`tool-motion` 的编辑器和预览仍仅限桌面端。

## 验证

在托管机器上，`install-motion.sh` 用时 36 秒完成，安装了 505 个字体样式。`render-motion` 把一个从 jsDelivr 加载 GSAP 并引用 Google Fonts 样式表的页面渲染为 3 秒、1280×720、30 fps 的 MP4，用时 4.5 秒，Google Sans Flex、CJK 文本和 emoji 均使用已安装的字体绘制。
