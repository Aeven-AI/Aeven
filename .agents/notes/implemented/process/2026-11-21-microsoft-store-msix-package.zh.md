# Agent Note：Windows 发布同时构建 Microsoft Store 包

Status: implemented

[English](2026-11-21-microsoft-store-msix-package.md) | 中文

## 问题

Windows 发布只提供 NSIS 安装程序，而发布工作流读取的 Azure Trusted Signing secret 一个都没有设置，因此每个 Windows 安装程序都以未签名状态发布，SmartScreen 会在运行前发出警告。NiftyLabs 开发者账号于 2026-11-20 通过 Microsoft Store 审核，Partner Center 预留了 "Æven" 产品（Store ID `9P7Q0BFG2Z9B`）。Store 会为它分发的每个 MSIX 包签名，所以 Store 包是唯一不需要我们自有证书的 Windows 分发方式。若三个月内没有提交包，预留就会失效。

## 决定

每条 Windows 打包命令在生成安装程序之后，再运行一次 electron-builder：带 `AVN_DESKTOP_STORE_PACKAGE=1` 执行 `--win appx --prepackaged <win-unpacked>`。这一步把安装程序已携带的应用打成 `aeven-<version>-win-<arch>-store.appx`，不会重新打包应用。在该模式下，`scripts/electron-builder-config.mjs` 选择 `appx` 目标、去掉 Trusted Signing，并从 `installer/appx/` 读取清单模板与磁贴图片。包本身保持未签名。Trusted Signing 证书无法为它签名，因为证书主题与清单中 Store 分配的发布者不一致时，signtool 会拒绝签名。

`MICROSOFT_STORE_IDENTITY` 保存 Partner Center 分配的值：身份名称 `AevenAI.ven`（Partner Center 去掉了 Æ）、发布者 `CN=361943AA-1813-410C-890C-540D8C89681E`、发布者显示名称 `AevenAI`、显示名称 `Æven`。身份或显示名称不一致的包会被 Store 拒绝。清单的 Description 使用 Linux 包已在显示的产品简介，而不是写给维护者的 package.json description。

清单模板在 `unvirtualizedResources` 受限功能下把 `desktop6:FileSystemWriteVirtualization` 与 `desktop6:RegistryWriteVirtualization` 设为 `disabled`。否则 Windows 会把打包应用对 `%APPDATA%` 与 `HKCU` 的写入重定向到每个包私有的存储中。这样 Chrome 永远读不到 `browser-extension.ts` 用 `reg add` 写入的 native messaging 宿主键。NSIS 安装与 Store 安装也会各自持有不同的 Electron 单实例锁，却共享同一个 Aeven 主目录，于是两个后端可能服务同一个配置。`minVersion` 为 10.0.18362.0，即首个遵循这些属性的版本。包声明了 `location`、`microphone` 与 `webcam`，因为 Windows 隐私设置按打包应用声明的功能授予设备访问权限。

当 `process.windowsStore` 为 true 时，应用跳过两步。`UpdateCoordinator` 报告没有更新配置，因为由 Store 替换包，而 electron-updater 会下载并运行 NSIS 安装程序。不调用 `setAsDefaultProtocolClient`，因为清单声明了 `aeven://`，而安装目录会随每次 Store 更新改变。native messaging 启动器仍写入 `process.execPath`，这没有问题，因为每次启动都会重写它。

发布工作流把每个 `.appx` 作为 `store-win-<arch>` 工作流产物上传，而不是发布资产：Windows 不会安装 Store 之外的未签名包。两个架构放进同一个 Partner Center 提交。

## 考虑过的替代方案

**把 `appx` 加进安装程序的目标列表。** 这样只打包一次，但签名发布会用 Trusted Signing 证书为 `.appx` 签名，而 signtool 会因发布者不一致失败。

**保留写入虚拟化。** 这样不需要受限功能，但会破坏浏览器扩展的 native messaging 注册，并让共享同一 Aeven 主目录的 Store 安装与 NSIS 安装分持两把单实例锁。

**把 `.appx` 发布到 GitHub Release。** 读者会下载到 Windows 拒绝安装的包。

## 后果

- Store 步骤为每个 Windows 目标增加一次 makeappx 运行。makeappx 与 makepri 来自 electron-builder 的 Windows 工具包，只能在 Windows 上运行，所以包在发布 runner 上构建，从不在 macOS 上构建。
- `unvirtualizedResources` 是受限功能，因此 Partner Center 提交必须说明理由：应用与未打包安装共享数据目录和浏览器注册。
- 同一台机器上的 Store 安装与 NSIS 安装共享一个配置和一个运行实例。
- Store 提交仍为手动：下载两个工作流产物并上传到 Partner Center。通过 Store 提交 API 自动化需要一个 Partner Center Entra 应用及其凭据。
