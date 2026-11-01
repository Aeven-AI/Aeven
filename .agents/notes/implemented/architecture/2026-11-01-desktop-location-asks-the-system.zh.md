# Agent Note: 桌面端定位请求由系统自己作答

Status: implemented

[English](2026-11-01-desktop-location-asks-the-system.md) | 中文

## 问题

桌面应用第一次使用 `get_location` 时超时，而 macOS 根本没有弹出定位授权提示。证据并不指向我们自己的接缝：定位从不经过 `ctx.approval`，`/var/db/locationd/clients.plist` 里 `com.aeven.desktop` 已是 `Registered = True` 且没有 `Authorized` 键，而在 **系统设置 → 隐私与安全性 → 定位服务** 里手动打开该应用后，同一次调用就返回了 `{source: "device", precision: "precise", accuracyMeters: 35}`。

缺口在 Electron 与 Chromium 之间。Electron 自己为渲染进程的定位权限作答，未安装权限处理器时直接授予，并调用 `GeolocationControl::UserDidOptIntoLocationServices()`。随后 Chromium 的 `GeolocationProviderImpl` 在 `GeolocationSystemPermissionManager` 报告 `kNotDetermined` 时不启动任何提供者（`OnClientsChanged` 提前返回），而只有 `RequestSystemPermission()` 才会产生决定——Chrome 的浏览器界面会调用它，Electron 从不调用。于是应用在 `locationd` 注册完成、提示不弹出、提供者不运行，`getCurrentPosition` 以一次看起来像设备故障的超时结束。

## 决策

系统层面的决定由外壳负责，客户端在读取之前先请求它。

- `apps/desktop/src/system-location.ts` 通过 koffi（桌面端已有的依赖，且已排除打包）绑定 CoreLocation，读取 `CLAuthorizationStatus` 并调用 `requestWhenInUseAuthorization` 弹出授权提示，最多等待 30 秒直到提示被回答。Windows 与 Linux 以整机开关作答、没有按应用的提示，因此该模块在那里报告 `system-managed`，并提供承载开关的设置面板（`ms-settings:privacy-location`；macOS 为定位服务面板）。
- 决定经由既有的 preload 桥 `avnDesktop.location.authorize()` 与 `.openSettings()` 过到页面，两者都在 `assertDesktopSender` 之后。
- `@aeven/client-ui-location` 通过 `readLocationWithPermission()` 读取：先系统决定，再 `navigator.geolocation`。开关被拒绝时渲染 `denied` 状态，卡片在 OK 旁边给出 **打开设置**，把恢复变成一个点击而不是翻遍系统设置。

## 曾考虑的替代方案

- **只提供设置面板深链** —— 没有提示的恢复手段，第一次使用依然死路，而那正是被报告的故障。
- **用 CoreLocation 自己读取位置** —— TCC 允许之后 Chromium 已经会给出位置；再绑定一次读取只会重复提供者与精度语义，毫无收益。
- **安装点名 `geolocation` 的 Electron 权限处理器** —— 它们回答的是渲染进程的权限，而那个一直是被授予的；系统决定是另一道闸门。

## 后果

macOS 上的首次使用现在会弹出系统提示，等待其回答的时间计入工具本身的同意超时，而不是读取的 10 秒。提示离不开 bundle 中的 `NSLocationWhenInUseUsageDescription`，而 `scripts/macos-usage-descriptions.mjs` 已经声明了它。浏览器中的页面保留浏览器自己的提示，报告 `system-managed` 且没有可提供的设置面板。桌面模块的绑定与平台分派已在本机运行过；提示本身只能在重新构建的应用中观察到，而发布携带的正是这样的应用。
