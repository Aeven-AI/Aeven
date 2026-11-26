# Agent Note：Windows 发布同时构建 Microsoft Store 包

Status: implemented

[English](2026-11-21-microsoft-store-msix-package.md) | 中文

## 问题

Windows 发布只提供 NSIS 安装程序，而发布工作流读取的 Azure Trusted Signing secret 一个都没有设置，因此每个 Windows 安装程序都以未签名状态发布，SmartScreen 会在运行前发出警告。NiftyLabs 开发者账号于 2026-11-20 通过 Microsoft Store 审核，Partner Center 预留了 "Æven" 产品（Store ID `9P7Q0BFG2Z9B`）。Store 会为它分发的每个 MSIX 包签名，所以 Store 包是唯一不需要我们自有证书的 Windows 分发方式。若三个月内没有提交包，预留就会失效。

## 决定

每条 Windows 打包命令在生成安装程序之后，再运行一次 electron-builder：带 `AVN_DESKTOP_STORE_PACKAGE=1` 执行 `--win appx --prepackaged <win-unpacked>`。这一步把安装程序已携带的应用打成 `aeven-<version>-win-<arch>-store.appx`，不会重新打包应用。在该模式下，`scripts/electron-builder-config.mjs` 选择 `appx` 目标、去掉 Trusted Signing，并从 `installer/appx/` 读取清单模板与磁贴图片。包本身保持未签名。Trusted Signing 证书无法为它签名，因为证书主题与清单中 Store 分配的发布者不一致时，signtool 会拒绝签名。

`MICROSOFT_STORE_IDENTITY` 保存 Partner Center 分配的值：身份名称 `AevenAI.ven`（Partner Center 去掉了 Æ）、发布者 `CN=361943AA-1813-410C-890C-540D8C89681E`、发布者显示名称 `AevenAI`、显示名称 `Æven`。身份或显示名称不一致的包会被 Store 拒绝。清单的 Description 使用 Linux 包已在显示的产品简介，而不是写给维护者的 package.json description。

清单模板为两类写入声明 `unvirtualizedResources` 受限功能。`desktop6:FileSystemWriteVirtualization` 设为 `disabled`。否则 Windows 会把应用及其代理运行的工具对 `%APPDATA%` 的每次写入重定向到每个包私有的存储中，其他程序读不到那里的 `npm install -g`、`pip install --user` 或被修改的设置文件。这些文件夹取决于读者的任务，因此没有任何 `virtualization:ExcludedDirectories` 列表能覆盖它们。NSIS 安装与 Store 安装也会各自持有不同的 Electron 单实例锁，却共享同一个 Aeven 主目录，于是两个后端可能服务同一个配置。对注册表，`virtualization:ExcludedKeys` 列出应用自己在每个 Chromium 浏览器下的键 `HKCU\Software\<浏览器>\NativeMessagingHosts\io.aeven.browser`，因为浏览器永远读不到 `browser-extension.ts` 用 `reg add` 写入的主机键的虚拟化副本。Windows 11 遵循该列表，并虚拟化其余所有注册表写入。Windows 10 没有按键排除的功能：`IgnorableNamespaces` 让它跳过该元素，而设为 `disabled` 的 `desktop6:RegistryWriteVirtualization` 使那里的所有注册表写入都不虚拟化。只排除这个键就够了：在 Windows 11 build 26300 上，即使浏览器的 `NativeMessagingHosts` 键尚不存在，从包内对它的写入也会到达真实的注册表配置单元，它旁边的同级键仍被虚拟化，Chrome 也启动了打包的主机。应用只写入 `windowsHostKeys()` 返回的四个键。读者在设置中关闭浏览器扩展时，`ExtensionIntegration` 会删除这些键以及主机清单和启动器，NSIS 卸载程序也会删除这些键；`tests/store-manifest.spec.ts` 使清单的排除项和卸载程序的删除项与该列表保持一致。Microsoft 拒绝了第一次提交，那次提交对整个应用关闭了两类虚拟化，理由只有一句话（2026-11-26 的认证报告，策略 10.6.3）。`minVersion` 为 10.0.18362.0，即首个遵循这些属性的版本。包声明了 `location`、`microphone` 与 `webcam`，因为 Windows 隐私设置按打包应用声明的功能授予设备访问权限。

当 `process.windowsStore` 为 true 时，应用跳过两步。`UpdateCoordinator` 报告没有更新配置，因为由 Store 替换包，而 electron-updater 会下载并运行 NSIS 安装程序。不调用 `setAsDefaultProtocolClient`，因为清单声明了 `aeven://`，而安装目录会随每次 Store 更新改变。native messaging 启动器仍写入 `process.execPath`，这没有问题，因为每次启动都会重写它。

发布工作流把每个 `.appx` 作为 `store-win-<arch>` 工作流产物上传，而不是发布资产：Windows 不会安装 Store 之外的未签名包。两个架构放进同一个 Partner Center 提交。

## 考虑过的替代方案

**把 `appx` 加进安装程序的目标列表。** 这样只打包一次，但签名发布会用 Trusted Signing 证书为 `.appx` 签名，而 signtool 会因发布者不一致失败。

**保留写入虚拟化。** 这样不需要受限功能，但会破坏浏览器扩展的 native messaging 注册，使其他程序都看不到代理的工具写入 AppData 的内容，并让共享同一 Aeven 主目录的 Store 安装与 NSIS 安装分持两把单实例锁。

**要求 Store 包只支持 Windows 11。** 这样每个 Store 安装都能使用精确的按键排除，但 Windows 10 读者将无法使用 Store 包，而认证报告接受在精确排除不可行时给出解释。

**把 `.appx` 发布到 GitHub Release。** 读者会下载到 Windows 拒绝安装的包。

## 后果

- Store 步骤为每个 Windows 目标增加一次 makeappx 运行。makeappx 与 makepri 来自 electron-builder 的 Windows 工具包，只能在 Windows 上运行，所以包在发布 runner 上构建，从不在 macOS 上构建。
- `unvirtualizedResources` 是受限功能，因此 Partner Center 提交必须逐点说明理由：为什么没有合适的目录列表、四个注册表键、应用不向注册表写入其他内容、这些键如何删除，以及卸载后留下什么。
- 卸载 Store 包时 Windows 不运行任何应用代码，并保留未虚拟化的数据。除非读者事先关闭了扩展或自行删除，四个注册表键、Aeven 主目录以及代理写入的文件都会留下。
- 同一台机器上的 Store 安装与 NSIS 安装共享一个配置和一个运行实例。
- Store 提交仍为手动：下载两个工作流产物并上传到 Partner Center。通过 Store 提交 API 自动化需要一个 Partner Center Entra 应用及其凭据。
