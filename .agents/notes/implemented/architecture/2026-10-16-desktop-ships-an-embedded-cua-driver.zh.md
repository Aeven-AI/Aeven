# Agent Note：桌面应用自带嵌入式 Cua Driver

Status: implemented

[English](2026-10-16-desktop-ships-an-embedded-cua-driver.md) | 中文

## 问题

[Issue 128](https://github.com/Aeven-AI/Aeven/issues/128)：在全新安装的 macOS 上，计算机使用没有注册任何工具。组合把提供方指向 `/Applications/CuaDriver.app/Contents/MacOS/cua-driver`，而全新机器上没有它，于是提供方只注册了安装指引工具，也没有任何地方告诉用户原因。Windows 与 Linux 安装同样依赖单独安装的驱动。

仅把 CuaDriver.app 放进 Aeven.app 并不能解决问题：独立驱动在通过 LaunchServices 启动守护进程和执行 `permissions grant` 流程时写死了 `/Applications/CuaDriver.app`，而且其签名带有预配描述文件，重新签名的副本会使其失效。

## 决定

`prepare-runtime` 为每个目标下载固定 `cua-driver-rs` 发行版中的裸驱动可执行文件（macOS 通用二进制，以及 Windows 与 Linux 的 arm64 或 x86_64 构建），按发行版的 `checksums.txt` 校验，并放入 `runtime/cua-driver`。electron-builder 会与其他嵌套可执行文件一起为它们签名；`scripts/helper-entitlements.plist` 在 electron-builder 的继承模板上加入 Apple Events，Info.plist 新增屏幕录制与 Apple Events 的用途说明，因为 macOS 会把这些请求归属于 Aeven。

除非启动环境已指定驱动，打包后的外壳会把 `AVN_CUA_DRIVER` 设为自带驱动并设置 `AVN_CUA_DRIVER_EMBEDDED=1`。组合把该标志映射到提供方的 `embedded` 字段，后者以 `CUA_DRIVER_EMBEDDED=1` 启动 `cua-driver mcp --embedded --direct`。上游的[嵌入指南](https://github.com/trycua/cua/blob/cua-driver-rs-v0.35.4/libs/cua-driver/rust/Skills/cua-driver/EMBEDDING.md)定义了该模式：驱动留在启动者的责任链内，因此 macOS 用 Aeven.app 的授权回答其辅助功能与屏幕录制检查，驱动本身从不弹出请求。桌面 Host 是 Electron 进程的直接子进程，所以责任链一直延伸到 Aeven.app；`health_report` 的 `bundle_identity` 指明 `com.aeven.desktop` 即可确认。

在 macOS 的嵌入模式下，`computer_use_setup` 通过 `osascript` JXA（带提示选项的 `AXIsProcessTrustedWithOptions` 与 `CGRequestScreenCaptureAccess`）为 Aeven 请求授权，`osascript` 同样运行在 Host 的责任链内。屏幕录制授权要在 Aeven 重启后才会作用于正在运行的驱动，因此结果会提示用户重新打开 Aeven。

## 考虑过的替代方案

**首次运行时把 CuaDriver.app 复制到 `/Applications`。** 这会写入应用包之外的位置，需要管理员账户，并留下拥有独立权限条目的第二个应用。

**用 `serve --embedded` 启动守护进程，再通过私有套接字连接 MCP 代理。** 上游指南为需要在多个客户端间共享一个驱动的宿主提供了这种方式；Aeven 每个 Host 只有一个 MCP 客户端，因此 `--direct` 只需一个进程且没有套接字生命周期。代价是 macOS 上没有代理光标叠加层。

## 影响

与任何 macOS 应用一样，Developer ID 重新签名或移动应用会使先前的授权失效。已在使用独立 CuaDriver 的机器，在以设置了 `AVN_CUA_DRIVER` 的方式启动 Aeven 时仍使用它；否则打包应用优先使用自带驱动。升级驱动只需修改 `apps/desktop/scripts/prepare-runtime.ts` 中的 `CUA_DRIVER_VERSION`。
