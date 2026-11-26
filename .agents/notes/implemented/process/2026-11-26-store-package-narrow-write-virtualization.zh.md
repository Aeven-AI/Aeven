# Agent Note: Store 包只把自己的文件夹和键排除在写入虚拟化之外

Status: implemented

[English](2026-11-26-store-package-narrow-write-virtualization.md) | 中文

## 问题

[Microsoft Store 包](2026-11-21-microsoft-store-msix-package.zh.md)声明了 `unvirtualizedResources` 受限功能。Microsoft 依据政策 10.6.3 拒绝了第一次提交，因为清单为整个包关闭了文件系统和注册表的写入虚拟化。2026-11-26 的认证报告要求说明哪些文件夹和键需要保持不虚拟化，并确认其他所有写入都保持虚拟化。第二次提交在 Windows 11 上把注册表收窄到四个键，但仍为整个包关闭 `desktop6:FileSystemWriteVirtualization`，在 Windows 10 上也仍为整个包关闭 `desktop6:RegistryWriteVirtualization`。两者都与报告的要求相悖。

## 决定

`installer/appx/AppxManifest.xml` 不含任何 `desktop6` 虚拟化属性。它把一个文件夹和四个键排除在写入虚拟化之外，对 AppData 和 `HKCU` 的其他所有写入，Windows 都会虚拟化：

- `virtualization:ExcludedDirectory` `$(KnownFolder:RoamingAppData)\Aeven`，即 Electron 的用户数据目录（`productName` 为 `Aeven`）。因此同一台机器上的 Store 安装与 NSIS 安装共享一个配置和一个单实例锁。
- `virtualization:ExcludedKey` `HKCU\Software\<browser>\NativeMessagingHosts\io.aeven.browser`，覆盖 Chrome、Chromium、Brave 和 Edge。这些就是 `windowsHostKeys()` 返回的键。浏览器从不读取它们的虚拟化副本。

浏览器宿主的启动器和清单位于 `$AVN_HOME/runtime`，Aeven 主目录是 `%USERPROFILE%\.aeven`。它在 AppData 之外，因此文件系统虚拟化从不作用于它。在 AppData 的其他位置，应用及其 Host 只做读取：浏览器配置、Git 与 Android SDK 位置，以及 Chromium 安装。

Windows 11 是第一个支持按目录和按键排除的版本。Windows 10 只提供针对整个包的 `desktop6` 属性，因此 `minVersion` 为 10.0.22000.0。`tests/store-manifest.spec.ts` 让被排除的键与 `windowsHostKeys()` 一致，让被排除的文件夹只有用户数据目录，并确保清单不含 `desktop6` 属性。

## 考虑过的替代方案

**继续为整个包关闭文件系统写入虚拟化。** 这样代理的工具可以写到 AppData 下任何位置，例如 `npm install -g`、`pip install --user` 或其他程序的设置文件，其他程序也能读到结果。认证报告把针对整个包的关闭选项视为需要论证去掉的东西，而任务涉及的文件夹无法预先知道，任何列表都列不出它们。

**排除整个 `%APPDATA%` 或 `%LOCALAPPDATA%`。** 这样其他程序能读到代理的工具在那里的写入，但这只是换了名字的整包关闭选项，会招致同样的拒绝。

**保留 Windows 10 并使用 `desktop6` 注册表关闭选项。** Windows 10 读者可以继续使用 Store 包，但该包在那里仍会为整个应用关闭注册表虚拟化。Windows 10 读者仍可使用 NSIS 安装程序。

**在 Windows 10 上开启注册表虚拟化并停用浏览器扩展。** 这样 Windows 10 仍能使用 Store 包，但应用需要识别这种情况并拒绝启用扩展。每个 Windows 10 Store 安装都会缺一项功能，而 Windows 10 的 Store 受众不值得为此多一种模式。

## 后果

- 在 Store 版本中，代理的工具写入 AppData 的内容会落到包的私有存储里。代理自己之后的命令能看到，其他程序看不到，卸载包时会被删除。NSIS 版本没有这种重定向。
- Store 包无法安装在 Windows 10 上；Windows 10 读者使用 NSIS 安装程序。
- 提交只需为一个文件夹和四个键说明理由，它们都归应用所有，并可确认其他所有写入都保持虚拟化。
- 卸载该包后会留下 `%APPDATA%\Aeven`、四个键（除非事先关闭了浏览器扩展）以及 Aeven 主目录。
