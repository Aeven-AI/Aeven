# Agent Note: Desktop seed 排除 Host 从不加载的依赖

Status: implemented

[English](2026-10-02-desktop-seed-excludes-unloaded-dependencies.md) | 中文

## 问题

Desktop 应用携带完整生产依赖图的离线 seed（[打包 Agent Note](2026-08-25-electron-desktop-packaging-and-updates.zh.md)）。一次实测的 Linux x64 构建解包后为 1,254 MB，其中 seed 为 840 MB；在同一锁文件上按目标平台安装的 seed，macOS 与 Windows 实测为 475–575 MB。其中三类内容没有任何运行时价值。

`onnxruntime-node` 曾因 MemOS 列在经过审查的 `allowBuilds` 策略中。它的安装脚本不构建任何东西：在 Linux x64 上，它从 nuget.org 下载约 205 MB 的 CUDA 与 TensorRT 执行 provider，在其他所有目标上什么也不做。seed 的离线验证安装运行了该脚本，pnpm 将 317 MB 的结果作为副作用记录到存储索引中，seed 随之发布了它。“离线”的首次启动安装也因此依赖 nuget.org。MemOS 的 embedder 请求 `device: "cpu"`，所以没有任何代码加载这些 provider。

pnpm 依赖图会安装每条声明的 `dependencies` 边，其中包括 `@aeven/client-ui-primitives` 的浏览器库（mermaid、cytoscape、KaTeX、highlight.js、react-dom）、`@aeven/client-ui-conversation` 中的 Lexical，以及 `@aeven/client-ui-sidebar-terminal` 中的 xterm：每个目标约 73 MB。Host 从不导入它们。Web 前端 `dist` 已编译进 `@aeven/client-ui-primitives` 及其字体和样式表，插件的 `lib/client.js` bundle 自带 Lexical 副本，xterm 则从该 `dist` 提供的浏览器模块表解析。这些库包仍然声明这些边，因为它们发布的 `lib/index.js` 由打包工具消费。

MemOS 的依赖图又增加了一份副本。`@huggingface/transformers` 在附件读取器的 `^0.35.3` 之外请求 `sharp@^0.34.5`，因而安装了第二份 libvips（17–20 MB）。Transformers.js 在加载时导入 `sharp`，但文本 embedding 不解码任何图像。

## 决定

生成的 Desktop workspace 文件（[`project-manager.ts`](../../../../apps/desktop/src/project-manager.ts)）拒绝 `onnxruntime-node` 的构建，仓库的 `pnpm-workspace.yaml` 采用同一策略。MemOS 使用该包自带的 CPU 运行时进行 embedding。

`DESKTOP_DEPENDENCY_OVERRIDES` 向每个 Desktop workspace 文件添加 pnpm `overrides`。`parent>child: "-"` 条目移除一条边，pnpm 会保留任何其他边仍能到达的包，因此 Host 包同样声明的库仍会安装。这些 overrides 移除 `@aeven/client-ui-primitives` 的全部依赖边、`@aeven/client-ui-conversation` 的 Lexical 边以及 `@aeven/client-ui-sidebar-terminal` 的 xterm 边。收录的 MemOS 核心不声明 `tsx` 依赖，因为其 stdio bridge 未被收录（[收录 note](../process/2026-10-06-vendor-memos-core.zh.md)）。`@huggingface/transformers>sharp` 解析到附件读取器的 `sharp` 版本范围。当某条被 override 的第一方边从其 workspace 清单中消失、`@aeven/client-ui-primitives` 新增了 overrides 未移除的依赖，或两个 `sharp` 范围出现分歧时，Desktop 单元测试会失败。

overrides 写入 workspace 文件，而不是作为存储裁剪应用，因此锁文件、离线安装证明、macOS seed 签名与 `integrity.json` 都描述缩减后的依赖图。启动时将已安装 profile 的 workspace 文件与该版本预期文件进行比较的检查无需改动即可覆盖它们。

## 考虑过的替代方案

**从 seed 存储中裁剪浏览器库的文件。** 现有的逐包裁剪规则固定精确版本，但 seed 自行解析锁文件，这些库会在其版本范围内浮动，固定版本的规则会在每次上游发布时导致构建失败。存储裁剪也会让这些包留在锁文件和依赖图中。

**把浏览器库移到 `devDependencies`。** 这会改变 `@aeven/client-ui-primitives` 发布到 npm 的内容，而它的 `lib/index.js` 为第三方打包工具导入这些库。Desktop 依赖图是唯一从不加载它们的消费者。

**首次使用时下载 Office、OCR 与 MemOS 引擎。** 这能让每个目标再节省 280–430 MB。暂不采用：首次使用时的下载会让功能阻塞在大文件传输上，并需要进度、失败和重试界面，[内置 Office 读取器 note](2026-09-29-bundled-office-reader.zh.md) 已记录这一点；而且 MemOS 必须在全新安装后即可使用。

## 影响

Linux x64 实测：seed 从 840 MB 降到 427 MB，解包后的应用从 1,254 MB 降到 840 MB。全新的 `AVN_HOME` 在 Xvfb 下启动打包后的应用，在没有任何网络下载的情况下离线安装 seed，通过暂存健康检查且 MemOS 到达 `pipeline.ready`，并渲染出登录页。在打包的 Node.js 上从已安装 seed 运行 Transformers.js feature-extraction，在 CPU 运行时与 `sharp` 0.35.5 上生成了 384 维的 MiniLM embedding。其他目标的测量方法是：用 pnpm `supportedArchitectures` 指定各目标安装同一锁文件，并应用发布裁剪规则；macOS arm64 从 515 MB 降到 405 MB。

依赖被 override 的第一方包的 Desktop 插件会得到同样缩减的依赖边。插件发布预构建的客户端 bundle，所以这与其 Host 部分能够加载的内容一致。开始导入被移除库的 Host 包必须声明该依赖；pnpm 随后会通过这条边保留该包。
