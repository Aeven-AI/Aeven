# Agent Note：托管 Web 上的动态影片

Status: implemented

[English](2026-11-06-hosted-motion-player.md) | 中文

## 问题

托管 Web 未挂载动态影片渲染器，因此那里从不注册 `show_motion`，托管对话也从不显示 Motion 卡片。模型用 bash 编写页面并用 jail 中的 `render-motion` 渲染（[托管动态影片](2026-11-06-hosted-sandbox-motion.zh.md)）；超过前台阈值的渲染会转为后台作业，而后台作业的文件从不共享，因此用户既看不到播放器也拿不到 MP4。基础组合中的 `bash-edit-guard` 还会拒绝原地改写，并让模型去用托管未挂载的 edit 与 write 工具。

## 决定

托管挂载 `ctx.motion` 与 [`avn-motion-sandbox`](../../../../packages/motion/motion-sandbox/README.zh.md)。其 `bundle()` 经由 `ctx.fs` 复制合成文件夹，只保留解析后目标位于该文件夹内的文件，并返回 HyperFrames 的单文档打包结果；`show_motion` 把该文档随调用存储，卡片从附件播放它。其 `render()` 在调用会话的沙箱策略下把同一文档通过管道送入 jail 的 `render-motion`；该策略由 `MotionRenderRequest.sandboxPolicy` 从 `avn-tool-motion` 以及 `avn-api-motion` 的 `POST /api/motion/export-call` 带入。`render-motion` 通过 HyperFrames 合成自身运行时的播放器（`__player.renderSeek`）逐帧推进，因此 MP4 与审阅静帧都与实时影片一致。卡片在没有可指明的文件夹时经由该调用路由导出；路由从调用方自己的日志取得文件夹，渲染超过 `exportWaitMs` 时回答 202，并返回 MP4 字节。`avn-api-motion` 的 `folderRoutes: false` 关闭读取任意 Host 绝对路径的路由，托管关闭 `bash-edit-guard`，模型说明把影片交给 motion 技能。

## 考虑过的替代方案

在 Host 上用 HyperFrames 渲染器渲染被否决：它会在账户 jail 之外用 Chromium 运行模型编写的页面。把打包文档写入账户文件夹供 jail 读取被否决：Host 侧写入可能跟随命令放置的符号链接，因此打包文档经由命令的标准输入传递。

## 影响

沙箱镜像必须带有读取标准输入并以 JSON 回答的 `render-motion`，由 `host/install-motion.sh` 安装。渲染在账户的 CPU 与内存限制下运行，1080p30 时约为影片时长的三倍。审阅影片写在合成的 `renders/.review.mp4`，每次审阅都会替换它，因为渲染器只能在工作区内写入。

## 验证

经由 `fs-local`、`motion` 与该渲染器打包一个合成时，场景与运行时均被内联，经由指向其他文件夹的符号链接到达的文件以及 `renders/` 下 80 MB 的文件被排除。`render-motion - out.mp4 --stills 3 --json` 在 18 秒内把一个桌面制作的 6 秒合成的打包文档渲染为 1920×1080、6.00 秒的 H.264 MP4，1、3、5 秒处的静帧显示柱形处于脚本设定的高度。
