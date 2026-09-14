# Agent Note: Windows arm64 desktop target

Status: implemented

[English](2026-09-14-windows-arm64-desktop-target.md) | 中文

## Problem

Windows 此前只有一个 Desktop 发布目标 `win-x64`。Windows on Arm 设备只能通过 x64 模拟运行该安装包，这会拖慢 Electron 外壳、内置 Node.js 运行时以及 seed 中的每个原生插件。`resolveDesktopPackageTarget` 也只在 Node.js 进程报告 `x64` 时才接受 Windows 主机，因此运行原生 arm64 Node.js 的 Windows on Arm 工作站无法打包任何 Windows 目标。

## Decision

`win-arm64` 是与 `win-x64` 并列的 Desktop 发布目标。它选择 electron-builder 的 `--win --arm64`，下载上游 `node-v<version>-win-arm64.zip` 运行时，并以与 `win-x64` 相同的 NSIS、EV 签名与 `--unsigned` 行为产出 `aeven-<version>-win-arm64.exe`。

两个 Windows 目标都要求 Windows 主机上的 Node.js 进程报告目标架构。seed 准备会运行内置的目标 Node.js 与 pnpm，使按平台与 CPU 过滤的可选依赖针对该目标解析，而主机检查保证该运行时可以执行。因此，Windows on Arm 主机用 arm64 Node.js 构建 `win-arm64`，用模拟下的 x64 Node.js 构建 `win-x64`。

`win-arm64` 通过更新频道发布到 `_/harness/desktop/stable/win-arm64/`。该目标目录的 `latest.yml` 或预发布频道文件与 `win-x64` 相互独立，因此每种已安装架构只读取自己的安装包元数据。

## Alternatives considered

**只向 Windows on Arm 提供 x64 安装包。** 模拟无需新增目标即可工作，但每次启动都要为转译 Electron 外壳、Node.js 与原生插件付出代价。原生目标消除了这一代价，并让发布产物与设备架构一致。

**把两种架构合并进一个 NSIS 安装包。** electron-builder 可以产出多架构安装包，但上传计划要求每份频道元数据恰好校验一个更新文件，而且 seed 与架构相关。独立目标使每个安装包、seed 与更新目录都能各自验证。

**在 Windows x64 或 macOS 主机上交叉打包 Windows arm64。** seed 准备必须执行目标 Node.js 才能解析按 CPU 过滤的可选依赖，因此无法运行 arm64 Windows 二进制的主机不能产出正确的 seed。

## Consequences

Windows on Arm 用户获得原生安装包与原生更新。发布自动化需要一台 Windows arm64 主机，例如 Apple Silicon 上的 Windows on Arm 虚拟机或 Windows on Arm runner，并需要 arm64 Node.js；签名构建还需连接 EV Token。

未发布 `win32-arm64` 原生构建的 seed 依赖会让 `win-arm64` 的 seed 准备或运行时加载失败，即使 `win-x64` 成功也是如此，因此首次运行 `win-arm64` 打包就是验证每个原生依赖的时机。

## Testing

`apps/desktop/tests/package-target.spec.ts` 覆盖 `win-arm64` 选择器、按主机默认选择目标，以及在 Node.js 架构不一致的主机上拒绝每个 Windows 目标。`apps/desktop/tests/desktop-build-paths.spec.ts` 覆盖其隔离的构建目录与目标解析，`apps/desktop/tests/desktop-auto-update-environment.spec.ts` 覆盖其更新目录，`apps/desktop/tests/desktop-upload-plan.spec.ts` 覆盖其安装包与频道元数据的上传计划。
