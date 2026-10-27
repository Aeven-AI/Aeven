# Agent Note：桌面发行不再构建未签名 macOS 变体

Status: implemented

[English](2026-10-27-drop-unsigned-mac-release-targets.md) | 中文

## 问题

发行流程在已签名的 macOS 目标之外还构建 `mac-arm64-unsigned` 与 `mac-x64-unsigned`，以便公证尚在排队时也有 DMG 可用。公证如今能顺利完成，而这两个变体并无收益：每个只产出 DMG，从不产出 ZIP 或更新源条目，因此 `latest-mac.yml` 从不列它们，更新器也无法安装。在 `0.3.20-alpha` 上，`mac-x64-unsigned` 在 Package 步骤 32 分钟后失败，而发布要求每个发行目标都完成，于是这一个无人下载的 DMG 让整个发行停在草稿状态。

## 决定

`.github/workflows/release-desktop.yml` 列出六个发行目标：`win-x64`、`win-arm64`、`mac-arm64`、`mac-x64`、`linux-x64` 与 `linux-arm64`。可复用的 `release-desktop-target.yml` 去掉 `variant` 输入以及所有读取它的分支：签名判定中的未签名变体短路、只收集 DMG 的资产收集，以及产物名与 job 名后缀。`plan` job 不再为每一行矩阵条目补上 `variant` 键。

签名回退保留。Windows 或 macOS 目标的密钥全部缺失时仍构建未签名产物，这是无凭据的 fork 生成安装包的方式；部分配置的目标依旧失败。

## 备选方案

保留两个目标并重跑失败的 job，等于重试一件无人下载的产物，而发行在它通过前始终是草稿。只删除 `mac-x64-unsigned` 则把同样无用的 arm64 DMG 和整套 `variant` 逻辑留在原处。

## 影响

macOS 发行只发布已签名并已公证的 DMG 与 ZIP。手动的 `targets` 输入不再接受这两个未签名 id；点名它们的一次运行会在 `plan` 中失败并打印六个已知目标。`apps/desktop/tests/update-residue.spec.ts` 仍会解析 `-unsigned.zip` 资产名：那是暂存更新文件的残留清理，与发行构建哪些目标无关。
