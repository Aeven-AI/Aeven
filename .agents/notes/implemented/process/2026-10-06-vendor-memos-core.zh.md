# Agent Note: 以源码形式收录 MemOS 核心

Status: implemented

[English](2026-10-06-vendor-memos-core.md) | 中文

## 问题

`@aeven/memory-memos` 在 Host 中运行 MemOS 核心，而 Aeven 会修改该核心的捕获与检索行为：摘要归属、Host LLM 调用上的操作名、向量候选上限以及关键词噪声。pnpm patch 只能修改已发布的文件，而 MemOS 包在 TypeScript 源码旁发布了编译后的 `dist/`，因此修改 `dist/` 的 patch 会让可读的源码描述并未运行的代码，无法做类型检查，并且每次升级都必须针对新的编译产物重写。即将进行的按账户拆分记忆也需要修改核心，其规模超出 patch 应承载的范围。

## 决策

MemOS 核心以 `@deepseek-ai/memos-local-plugin` 的形式收录在 `vendor/memos-local-plugin/`，固定在上游发布标签 `memos-local-plugin-v2.0.20`（MemTensor/MemOS 提交 `1c5e895be455`）。其 `src/` 存放上游的 `core/`、`agent-contract/` 和 `server/` 目录树；`viewer/dist/` 是对应 npm 包中预构建的 Viewer。Aeven 的修改是对这些源码的编辑，记录在 [vendor/README.md](../../../../vendor/README.md#local-modifications) 中；pnpm patch 及其 `patchedDependencies` 条目已删除。

该包在仓库的 TypeScript 项目图中按收录包的放宽设置编译，并使用包内的 tsdown 配置构建：保留模块树（`unbundle`），并把 SQL 迁移复制到编译后的迁移器旁边，因为 MemOS 相对于 `storage/migrator.js` 定位迁移文件，而 `@aeven/memory-memos` 按模块导入，例如 `@deepseek-ai/memos-local-plugin/core/index.js`。源码平面的项目图通过 `tsconfig.base.json` 的 `paths` 条目把这些子路径解析到 `src/`。

收录副本省略了 Aeven 从不加载的内容：stdio bridge 及其 `tsx` 守护进程启动器、OpenClaw 与 Hermes 适配器、安装脚本、测试、模板以及 `telemetry.credentials.json`。Aeven 不向核心传入遥测实例，因此从未读取过该凭据文件。其依赖是复制的目录树所导入的五个包。

## 考虑过的替代方案

**保留 pnpm patch。** 无需额外设置，但它修改的是没有编译器检查的编译产物，每次修改和升级都要手工编辑生成的 JavaScript。

**同时修改随包发布的 TypeScript 源码与 `dist/`。** 两份副本必须手工保持一致，而运行时执行的仍是编译后的副本。

**以 git 依赖使用 GitHub fork。** 修改会转移到第二个仓库和发布流程中，Desktop seed 还需要离线安装 git 依赖；而工作区包会与其他第一方包一起打包。

**收录整个 npm 包，包括 `dist/` 和适配器。** 适配器导入的 agent 宿主不是这里的依赖，无法编译；保留 `dist/` 则会留下第二份不受跟踪的代码副本。

## 影响

对 MemOS 的修改成为普通的、经过评审的源码编辑，并与仓库其余部分一起做类型检查；编译这些源码可以逐字节重现 patch 下运行的代码。上游修复现在只能通过 `vendor/README.md` 中的同步流程引入：从发布标签重新复制三个目录树，并重新应用已记录的修改。在 Viewer 的 Preact 源码被收录并在此构建之前，Viewer 仍是预构建产物。MemOS 的 manifest 声明 MIT，而 MemOS 仓库根目录带有 Apache-2.0 `LICENSE`；notices 同时记录了两者。
