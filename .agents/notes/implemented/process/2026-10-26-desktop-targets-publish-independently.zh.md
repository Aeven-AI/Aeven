# Agent Note: Desktop 目标独立发布

Status: implemented

[English](2026-10-26-desktop-targets-publish-independently.md) | 中文

## 问题

依赖整个构建 matrix 的发布作业会在签名 Intel macOS 等待 Apple 时扣住所有已完成的安装包。单个目标失败也会阻止无关平台发布。

## 决定

[发布工作流](../../../../.github/workflows/release-desktop.yml)为每个选定目标调用一次[可复用工作流](../../../../.github/workflows/release-desktop-target.yml)。每次调用在自身构建成功后上传。发布作业共享仓库级并发组并设置 `queue: max`，因此版本创建与更新元数据替换串行执行，不会取消等待中的目标。第一个完成的目标创建草稿版本，后续目标向其添加资产；所有目标上传完成后版本才公开（[发布规则](2026-10-26-desktop-release-public-after-every-target.zh.md)）。安装包与 blockmap 先于引用它们的更新元数据上传。

Linux 立即发布各目标的更新元数据。Windows 与 macOS 上传带架构后缀的 manifest（元数据清单），且只在版本中存在两个架构的 manifest 后发布共享更新元数据。合并器保留 x64 的顶层字段。不签名的 macOS 只提供 DMG。当前架构的安装包缺失时，更新器可能回退到其他架构，因此不完整的共享更新元数据不安全。

[目标选择策略](2026-10-14-desktop-release-target-selection.zh.md)仍要求发布运行选择全部目标；每个成功的构建都会上传，不受其他目标影响。[macOS 作业上限](2026-10-15-macos-release-builds-run-to-the-github-ceiling.zh.md)仅限制该目标的可用时间。

## 考虑过的替代方案

**等待整个 matrix 后发布。** 这能防止不完整的版本，但会让一个平台的签名队列阻塞所有下载。

**在共享更新元数据中只发布已完成的架构。** 这能更早提供更新元数据，但可能向另一架构提供不兼容的安装包。

**为各架构提供独立更新通道。** 这也能拆分自动更新，但需要修改客户端配置，且不会改变仍请求共享通道的已安装客户端。

## 后果

构建失败会留下草稿版本和失败的工作流；重新运行可补上缺失的目标并发布版本。目标 manifest 保留为公开发布资产，供后续发布者合并，无需下载其他目标的安装包。当前运行中的工作流保留原始作业依赖；此改动适用于后续运行。
