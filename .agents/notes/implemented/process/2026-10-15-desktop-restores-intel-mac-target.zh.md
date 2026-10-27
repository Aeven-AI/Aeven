# Agent Note: Desktop 恢复 Intel Mac 构建目标

Status: implemented

[English](2026-10-15-desktop-restores-intel-mac-target.md) | 中文

## Problem

`mac-x64` 之所以离开 Desktop 发布集合，是因为 MemOS 的 embedding 走 Transformers.js，而后者把 `onnxruntime-node` 固定为 1.24.3，该版本不发布 `darwin/x64` 绑定；Intel 版本因此附带了一个原生模块无法加载的 embedder。（[移除记录](../../archived/process/2026-10-02-desktop-drops-intel-mac-target.md)，已归档。）

## Decision

Desktop 的目标集合为 `mac-arm64`、`mac-x64`、`win-arm64`、`win-x64`、`linux-arm64` 与 `linux-x64`。[`project-manager.ts`](../../../../apps/desktop/src/project-manager.ts) 通过替换 Transformers.js `sharp` 时使用的同一机制，把 `@huggingface/transformers>onnxruntime-node` 覆盖为 `1.23.2`，即仍发布 `darwin/x64` 绑定的最新版本；`pnpm-workspace.yaml` 为仓库与 CLI 安装固定同一版本。seed 剪裁规则改为 `1.23.2`，并为每个平台（含 macOS）移除另一架构的运行时。发布自动化在 `macos-15-intel` 上构建 `mac-x64`，使用与 `mac-arm64` 相同的 Developer ID 身份与公证凭据签名，并把两个 macOS 更新元数据合并为一个 `latest-mac.yml`，使 Intel Mac 不会下载 arm64 的 ZIP。另一个始终不签名的 DMG 变体已[移除](2026-10-27-drop-unsigned-mac-release-targets.zh.md)。

该固定让实际安装的 Transformers.js 运行在比其声明更旧的 ONNX Runtime 上，因此两者都被测量。固定句子经 `Xenova/all-MiniLM-L6-v2`（`q8`、cpu）embedding 后，在 arm64 上 1.24.3 与 1.23.2 返回相同向量；在 darwin/x64 上 1.23.2 的结果与 arm64 相差至多 3.4e-08，属于浮点噪声，而非 embedding 变化。本地 `mac-x64 --prepare-only --unsigned` 构建产出了完整发布载荷：319 个一方包与 10 个 vendor 包、`darwin-x64` 的 whisper worker 与 WhatsApp 守护进程、Node.js 运行时、package set，以及一个 lockfile 解析为 `onnxruntime-node@1.23.2`、17 个 Mach-O 对象全部为 x86_64 的 seed。

## Alternatives considered

**在 Intel macOS 上不提供本地 embedding。** MemOS 会降级而非失败：capture 存入空向量并排队重试，retrieval 退回其关键词通道。这会移除向量召回——排序各层所围绕的通道——并让重试队列永久运行。

**把 1.23.2 的 `darwin/x64` 绑定文件并入 1.24.3。** 依赖补丁可保留较新运行时的 JavaScript，代价是一个未经认证的原生/JavaScript 组合，且每次升级 ONNX Runtime 都必须重新推导。

**等待上游。** 微软表示不会发布官方 x86_64 macOS 构建，当前版本仍只发布 `darwin/arm64`。

**维持移除该目标。** 这样 Intel Mac 完全无法安装 Desktop 版本；上一份记录之所以接受，是因为那里没有任何 embedding 运行时可以加载。

## Consequences

- 通过该覆盖，所有 Transformers.js 版本都保持 `onnxruntime-node` 1.23.2；若某次升级需要更新的 ONNX Runtime API，会在安装时失败，而不是在召回时失败。
- MemOS 记忆在 Intel macOS 与 Apple Silicon 上行为一致，并按同一发布节奏更新。
- 发布集合增至六个目标，而 macOS 更新元数据的合并是保证其更新架构正确的一环。
- Intel macOS 已是收尾平台：macOS 26 是它的最后一个版本，Apple 正在停用 Rosetta，GitHub 的 x86_64 macOS runner 将随 macOS 15 镜像于 2027 年秋季退役。本决策随之到期。
- `minimumSystemVersion` 保持 `14.0`。1.23.2 的 darwin 库只要求 13.4，因此后续可以下调；目前没有依赖这一点。
