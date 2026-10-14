# Agent Note: Desktop 移除 Intel Mac 构建目标

Status: implemented

[English](2026-10-02-desktop-drops-intel-mac-target.md) | 中文

## 问题

Desktop 发布集合曾包含 `mac-x64`，即由 Apple Silicon 宿主通过 Rosetta 构建的 Intel macOS 版本。MemOS 长期记忆是每个 Desktop 安装的组成部分，它使用 Transformers.js 计算 embedding，而 Transformers.js 精确固定 `onnxruntime-node` 1.24.3。该包只发布 `darwin/arm64`、`linux/{arm64,x64}` 与 `win32/{arm64,x64}` 的原生绑定，Transformers.js 加载它时，其加载器会 require `bin/napi-v6/<platform>/<arch>/onnxruntime_binding.node`。因此 Intel Mac 版 Desktop 发布的 MemOS 没有可加载的运行时，却仍携带 57 MB 的 embedding 依赖。

## 决定

Desktop 构建目标集合为 `mac-arm64`、`win-arm64`、`win-x64`、`linux-arm64` 与 `linux-x64`。[`package-target.ts`](../../../../apps/desktop/scripts/package-target.ts)、[`desktop-build-paths.mjs`](../../../../apps/desktop/scripts/desktop-build-paths.mjs)、``desktop-auto-update-environment.mjs`` 与 ``desktop-upload-plan.ts`` 不再接受 `mac-x64`；未显式指定目标的 Intel Mac 构建宿主会以不受支持的宿主失败，而不是选择该目标。`package:mac:x64*` 与 `upload:mac:x64` 脚本、运行时准备中的 Rosetta 执行检查，以及 macOS JIT 签名模式中的 Intel LibreOffice 引擎均已移除。

CLI 保留其 Intel macOS 平台包，例如 `@aeven/whisper-cpp-darwin-x64`：npm 用户自行选择安装方式，本决定只涉及 Desktop 发布集合。

## 考虑过的替代方案

**为该目标固定一个带 Intel macOS 二进制的旧版 `onnxruntime-node`。** Transformers.js 4.2.0 精确固定 1.24.3，因此 override 会在单一平台上发布一个无人验证的运行时与模型加载器组合。

**在 Intel Mac 上用 WebAssembly 后端运行 MemOS embedding。** MemOS 在其本地 embedder 中硬编码 `device: "cpu"`，因此这需要修补一个固定版本的第三方包，并在 Apple 已停止发售的平台上接受更慢的 embedding。

**保留该目标并在其上禁用 MemOS。** MemOS 是每个 Desktop 安装的产品组成部分；没有它的目标将是另一个产品。

## 影响

Intel Mac 用户无法安装 Desktop 版本。CLI 仍可在其上安装，但其 MemOS embedding 依赖同一个 `onnxruntime-node` 二进制文件，无法加载。发布自动化构建五个目标，更新服务器不再接收 `mac-x64` 更新流；由于上传从不删除历史对象，早期 `mac-x64` 版本仍留在服务器上，但不会再有更新版本到达它们。
