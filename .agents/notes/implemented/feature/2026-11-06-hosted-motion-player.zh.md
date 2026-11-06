# Agent Note：托管 Web 上的实时动态影片播放器

Status: implemented

[English](2026-11-06-hosted-motion-player.md) | 中文

## 问题

托管 Web 未挂载动态影片渲染器，因此那里从不注册 `show_motion`，托管对话也从不显示 Motion 卡片。模型用 bash 编写页面并用 jail 中的 `render-motion` 渲染（[托管动态影片](2026-11-06-hosted-sandbox-motion.zh.md)）；超过前台阈值的渲染会转为后台作业，而后台作业的文件从不共享，因此用户既看不到播放器也拿不到 MP4。基础组合中的 `bash-edit-guard` 还会拒绝原地改写，并让模型去用托管未挂载的 edit 与 write 工具。

## 决定

托管挂载 `ctx.motion` 与 [`avn-motion-preview`](../../../../packages/motion/motion-preview/README.zh.md)，这是一个只打包的渲染器：它经由 `ctx.fs` 复制合成文件夹，只保留解析后目标位于该文件夹内的文件，并返回 HyperFrames 的单文档打包结果。`show_motion` 把该文档随调用存储，卡片从附件播放它，与它在账户其他设备上的做法相同。`avn-tool-motion` 新增 `render: false`，去掉静帧与 `render_motion`，并讲授只展示的流程；`avn-api-motion` 新增 `folderRoutes: false`，因为其文件夹路由读取任意 Host 绝对路径。托管关闭 `bash-edit-guard`，模型说明把影片交给 motion 技能，`render-motion` 只用于用户要求的 MP4。

## 考虑过的替代方案

在 Host 上用 HyperFrames 渲染器生成静帧与导出被否决：它会在账户 jail 之外用 Chromium 运行模型编写的页面。在 jail 内运行 HyperFrames 渲染被推迟：`render-motion` 驱动页面的 GSAP 全局时间线，而合成需要 HyperFrames 运行时自身的定位，且 `ctx.motion` 收不到用于选择账户 jail 的会话。

## 影响

托管影片可实时播放与拖动；模型不审阅静帧，卡片菜单下载打包后的页面而非 MP4。打包在 Host 上读取账户文件夹，采用与托管读取工具相同的先解析后读取的包含检查。

## 验证

经由 `fs-local`、`motion` 与 `motion-preview` 打包一个合成时，场景与运行时均被内联，经由指向其他文件夹的符号链接到达的文件以及 `renders/` 下 80 MB 的文件被排除，且 `render()` 拒绝。
