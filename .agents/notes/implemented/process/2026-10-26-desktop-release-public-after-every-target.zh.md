# Agent Note: Desktop 版本在所有目标完成后公开

Status: implemented

[English](2026-10-26-desktop-release-public-after-every-target.md) | 中文

## 问题

electron-updater 的 GitHub provider 从 releases feed 中取最新的公开版本，并下载该版本的通道文件（`latest-mac.yml`、`latest.yml` 等），不会回退到更早的版本。当每个目标完成时都公开版本，v0.3.16-alpha 在签名 macOS 与 win-arm64 构建仍在运行时，已带着 Linux、win-x64 与不签名 macOS 资产公开。已安装的 macOS 与 Windows 客户端在 v0.3.16-alpha 中找不到通道文件，报告无更新，也看不到已完整发布的 v0.3.15-alpha。

## 决定

各目标仍独立构建并上传（[按目标上传](2026-10-26-desktop-targets-publish-independently.zh.md)），但上传到草稿版本。[发布工作流](../../../../.github/workflows/release-desktop.yml)中最后的 `publish` 作业依赖所有目标，只在全部成功后公开版本。重新运行失败的目标会重新运行该作业。

## 考虑过的替代方案

**保留提前发布，并在客户端回退。** 通道文件缺失时，桌面更新器可以查找最新的带通道文件的版本。已安装的客户端没有这种回退，在通过其他方式更新前仍会错过更新。

## 后果

所有下载都要等待最慢的目标，通常是在 Apple 公证队列中的签名 Intel macOS。已安装的客户端不会看到缺少其平台更新元数据的版本。
