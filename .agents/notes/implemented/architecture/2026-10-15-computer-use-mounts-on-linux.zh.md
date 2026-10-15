# Agent Note：计算机操作在 Linux 上通过 Cua Driver 提供方挂载

Status: implemented

[English](2026-10-15-computer-use-mounts-on-linux.md) | 中文

## 问题

Web 和 Electron 组合只在 macOS 和 Windows 上挂载计算机操作：[`packages/bundle/web-app/cordis.patch.yml`](../../../../packages/bundle/web-app/cordis.patch.yml) 用 `darwin` 与 `win32` 关闭了 `computer-use` 服务行和 `computer-use-cua-driver` 行，且每个平台的行各自带有驱动的安装位置。在 Linux 上，各包已安装在桌面配置中，却没有 `cua-driver-mcp` MCP 服务器服务于会话，因此 Linux 会话既没有 `mcp__cua-driver-mcp__*` 工具，也没有 `computer_use_setup`；安装驱动也不会有任何变化，因为没有行挂载它。已发布的 Linux 桌面适配器 [`@aeven/computer-use-linux`](../../../../packages/computer-use/computer-use-linux/README.zh.md) 不是提供方——其自有测试之外没有任何代码引用它——因此无法顶替该行。

## 决策

两个行现在都在 macOS、Windows 与 Linux 上挂载，且驱动行给出三种安装位置：macOS 上为 CuaDriver 应用包，Windows 上为 `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`，Linux 上为 `~/.local/bin/cua-driver`，即用户级安装写入的脚本位置。`AVN_CUA_DRIVER` 可覆盖其中任一位置。

该绝对默认值承担关键作用。[`@aeven/computer-use-cua-driver-mcp`](../../../../packages/computer-use/computer-use-cua-driver-mcp/README.zh.md) 在启动前会检查绝对 `command`，路径不存在时只注册带安装指引的 `computer_use_setup`。而 PATH 命令名会在不做检查的情况下被启动，因此在未安装驱动的机器上会使该条目激活失败——这正是 macOS 语义批次行通过探测驱动路径所避免的失败。

Linux 只挂载驱动的工具集。两个批量提供方在那里都不可用：macOS 的依赖 Apple Events，Windows 的驱动 UI Automation 与 COM，而本可为第三方的 Linux 适配器不注册提供方，因此 Linux 上不提供 `computer_use_run` 行。

### 验证

- [`packages/bundle/web-app/tests/computer-use-rows.spec.ts`](../../../../packages/bundle/web-app/tests/computer-use-rows.spec.ts) 按 Loader 的方式逐个平台解析这些行：能力与驱动提供方在 `darwin`、`win32`、`linux` 上挂载；各平台默认值与 `AVN_CUA_DRIVER` 覆盖解析为预期路径；macOS 语义批次在 macOS 之外或缺少驱动时保持关闭；Windows 批次仅在 Windows 上挂载。
- 可选启用的实机检查 [`installed-driver.e2e.ts`](../../../../packages/computer-use/computer-use-cua-driver-mcp/tests/installed-driver.e2e.ts) 在 Ubuntu 24.04 aarch64 客户机上、针对安装在 `~/.local/bin/cua-driver` 的 cua-driver 0.28.0 通过：它注册 `cua-driver-mcp`、发现驱动工具、以 `prompt: false` 调用 `check_permissions`，并在释放时归还注册。

## 备选方案

**改为挂载已发布的 Linux 桌面适配器。** [`@aeven/computer-use-linux`](../../../../packages/computer-use/computer-use-linux/README.zh.md) 实现了桌面契约但不注册提供方，因此该路线需要新建一个一方包。在 GNOME Wayland 上它还找不到窗口后端——没有 `hyprctl`、没有 `i3-msg`，而 `wmctrl` 无法读取 Wayland 合成器——无障碍树、点击和截图均未实现，会在驱动可用之处报告阻塞。

**将 Linux 的 `command` 默认设为裸 `cua-driver` PATH 命令名。** 提供方对 PATH 命令不做检查就启动，因此在未安装驱动的机器上会使该行失败，而不是提供安装指引；这正是 macOS 与 Windows 行都给出绝对安装位置的原因。

**保持各行仅限 macOS 与 Windows。** 它让桌面应用自身的 Linux 用户在安装驱动后仍得不到该能力，且没有任何可见提示说明某行被关闭。

## 影响

只要驱动存在于默认路径或被覆盖的路径，Linux 会话就会挂载该提供方；若不存在，`computer_use_setup` 会给出缺失路径和上游指南，即 macOS 与 Windows 行本就具备的可发现性。Linux 驱动构建的验证版本为 0.28.0，也正是提供方在 `INSTALL_GUIDE` 中固定的版本：当前上游发布版 0.35.4 已不接受 `check_permissions` 的 `prompt` 参数，并自带 `browser_*` 工具，因此更新的驱动会改变参数面，并与本组合已挂载的 Playwright 和 Chrome DevTools MCP 行重复。Linux 不新增批量提供方，其会话只驱动驱动自带的工具。驱动自身在 Linux 上的权限要求——输入注入与无障碍总线——不因本决策改变，且除 Web 和 Electron 外没有其他组合继承这些行。
