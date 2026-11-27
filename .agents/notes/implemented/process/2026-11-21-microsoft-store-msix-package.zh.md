# Agent Note：Windows 发布同时构建 Microsoft Store 包

Status: implemented

[English](2026-11-21-microsoft-store-msix-package.md) | 中文

## 问题

Windows 发布只提供 NSIS 安装程序，而发布工作流读取的 Azure Trusted Signing secret 一个都没有设置，因此每个 Windows 安装程序都以未签名状态发布，SmartScreen 会在运行前发出警告。NiftyLabs 开发者账号于 2026-11-20 通过 Microsoft Store 审核，Partner Center 预留了 "Æven" 产品（Store ID `9P7Q0BFG2Z9B`）。Store 会为它分发的每个 MSIX 包签名，所以 Store 包是唯一不需要我们自有证书的 Windows 分发方式。若三个月内没有提交包，预留就会失效。

## 决定

每条 Windows 打包命令在生成安装程序之后，再运行一次 electron-builder：带 `AVN_DESKTOP_STORE_PACKAGE=1` 执行 `--win appx --prepackaged <win-unpacked>`。这一步把安装程序已携带的应用打成 `aeven-<version>-win-<arch>-store.appx`，不会重新打包应用。在该模式下，`scripts/electron-builder-config.mjs` 选择 `appx` 目标、去掉 Trusted Signing，并从 `installer/appx/` 读取磁贴图片。包本身保持未签名。Trusted Signing 证书无法为它签名，因为证书主题与清单中 Store 分配的发布者不一致时，signtool 会拒绝签名。

`MICROSOFT_STORE_IDENTITY` 保存 Partner Center 分配的值：身份名称 `AevenAI.ven`（Partner Center 去掉了 Æ）、发布者 `CN=361943AA-1813-410C-890C-540D8C89681E`、发布者显示名称 `AevenAI`、显示名称 `Æven`。身份或显示名称不一致的包会被 Store 拒绝。清单的 Description 使用 Linux 包已在显示的产品简介，而不是写给维护者的 package.json description。

包使用 electron-builder 自带的清单模板，除 `runFullTrust` 外不声明任何受限功能，要求 Windows 10 1809（`10.0.17763.0`）；应用对 AppData 和 `HKCU` 的所有写入，Windows 都会虚拟化。Microsoft 三次拒绝了 `unvirtualizedResources`，因此浏览器扩展通过回环 WebSocket 连接 Store 安装；它为旧扩展写入的原生消息主机键留在其虚拟化注册表中（[回环 WebSocket Agent Note](../architecture/2026-11-27-browser-extension-loopback-websocket.zh.md)）。包声明了 `location`、`microphone` 和 `webcam`，因为 Windows 隐私设置按打包应用声明的功能授予设备访问权限。

当 `process.windowsStore` 为 true 时，应用跳过两步。`UpdateCoordinator` 报告没有更新配置，因为由 Store 替换包，而 electron-updater 会下载并运行 NSIS 安装程序。不调用 `setAsDefaultProtocolClient`，因为清单声明了 `aeven://`，而安装目录会随每次 Store 更新改变。

发布工作流把每个 `.appx` 作为 `store-win-<arch>` 工作流产物上传，而不是发布资产：Windows 不会安装 Store 之外的未签名包。两个架构放进同一个 Partner Center 提交。

## 考虑过的替代方案

**把 `appx` 加进安装程序的目标列表。** 这样只打包一次，但签名发布会用 Trusted Signing 证书为 `.appx` 签名，而 signtool 会因发布者不一致失败。

**把 `.appx` 发布到 GitHub Release。** 读者会下载到 Windows 拒绝安装的包。

## 后果

- Store 步骤为每个 Windows 目标增加一次 makeappx 运行。makeappx 与 makepri 来自 electron-builder 的 Windows 工具包，只能在 Windows 上运行，所以包在发布 runner 上构建，从不在 macOS 上构建。
- 卸载 Store 包会删除它在 AppData 和 `HKCU` 中被虚拟化的写入。Aeven 主目录以及代理在 AppData 之外写入的文件会留下。
- 同一台机器上的 Store 安装与 NSIS 安装各自保留配置，并可同时运行。
- Store 提交仍为手动：下载两个工作流产物并上传到 Partner Center。通过 Store 提交 API 自动化需要一个 Partner Center Entra 应用及其凭据。
