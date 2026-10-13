# Agent Note: 关闭 computer-use 栈留下的红色文档门禁

Status: implemented

[English](2026-09-22-documentation-gates-after-computer-use.md) | 中文

## Problem

`main` 上的 `pnpm run doc-sync` 有四个门禁是红的，全部由同一次变更带入（`9421149a37 Add the self-contained computer-use stack and browser overlay`），此后一直未处理：

- **`verify-doc-graphs` 不是失败，而是崩溃。** 该栈发布了第二个 Cordis 服务 `computerUseProvider`（macOS 适配器的提供方对象，通过模块增强声明）。图生成器要求 `scripts/gen-doc-graphs.ts` 中的每个已发现服务都被分类，只要有一个未分类就拒绝渲染，因此任何图文档都无法被检查。
- **`verify-export-jsdoc`：65 个导出名缺少文档**——其中 53 个在 `packages/experimental/browser-overlay`（`motion.ts`、`springs.ts`、`styles.ts`），其余分布在八个 `computer-use` 包中。
- **`doc-typecheck`：27 个 README 代码块无法编译**——示例引用了块内从未声明的名字（`startedAt`、`router`、`handlers`、`runner` 等），几乎全在 `packages/computer-use/*/README.md`。
- **`verify-type-equiv`：两个子系统页面与其镜像的源码脱节**（`CompactionTrigger` 的 JSDoc 只有一行，而源码有四行；`ResolvedCredential` 的源码层列表已增加 `session`）。

第五个问题藏在这些计数里。lint-contract 测试会把一个探针写进某个包的 `src`，以证明聚合 lint 配置能捕获它，随后再删除；被中止的运行会留下一个，而**与它并行**运行的扫描可能枚举到一个届时已被删除的探针。这正是 `scripts/gen-client-catalog.spec.ts` 以 `ENOENT` 失败的原因，也是 `verify-export-jsdoc` 中有一行指向 `client/ui-primitives` 的原因——那个包根本没有任何未文档化的导出。

## Decision

每个问题都在其归属处修复，且没有任何一项被消音：

- **`computerUseProvider` 被分类，而不是被隐藏。** 它获得一条 `SERVICE_ROLES` 记录，`mode: 'core'`、`pkg: 'computer-use'`（与 `scripts/gen-cordis-catalog.ts` 早已将它归属的位置一致）、`implementations: ['computer-use-macos-provider']`，于是 `gen-doc-graphs` 恢复渲染，`docs/capability-seams.md` 得到它的节点、两条边与表格行。
- **每个未文档化的导出都被补上文档**，说明该函数或属性是什么、调用方可以依赖什么。原先两个声明共用一条注释的常量各自获得一段，因为二者如今各自是一个被文档化的单元。
- **README 示例被改为可编译，而不是被豁免。** README 的围栏代码块在其英文与中文两侧逐字节相同，因此每处改动都同时施加于两侧并重新记录配对。
- **两个脱节的子系统页面被对齐到其源码**：JSDoc 与来源层列表，双语同时更新。
- **瞬时探针离开槽位扫描的语料。** `scripts/slot-walk.ts` 在它的两个扫描中都过滤 `oxlint-contract-<id>.ts(x)`，理由记录在过滤处，且使用的正是逐文件覆盖率门禁早已排除的同一名称。`scripts/slot-walk.spec.ts` 覆盖该边界：探针被跳过、真实声明被索引、仅仅名称相近的 `oxlint-contracts.ts` 被索引。
- **一处改动前摘录被标注为摘录。** 启动 gate 的注记引用了它替换掉的 `if (await this.gateOnAuthentication()) { … return }`，该片段无法独立编译；其围栏采用仓库中其它注记对同类摘录使用的 `ts ignore-check` 写法。

## Alternatives considered

**用 `ignore-check` 把失败的 README 代码块豁免掉。** 最快，已否决：语料目前已忽略 45% 的代码块，上限是 50%，而豁免是为无法编译的摘录准备的，不是为写错的示例准备的。本次改动中的每个代码块在示例补全后都能编译。

**删除 README 中的示例。** 它们讲解这些包的组合方式，而这正是新栈的读者最需要的材料。示例是转录不完整，而不是性质错误。

**把探针排除继续留给覆盖率门禁。** 那个门禁早已排除该名称，这正是残留物在其中不可见的原因；槽位扫描与 export-jsdoc 扫描读的是同一个目录，却没有同样的防护。在枚举语料之处排除它，一次修好两个读取方。

**退役 `computerUseProvider` 而不是为它写文档。** 该服务今天没有生产消费方——只有其适配器的测试会寻址它——因此"每个抽象都必须有当前消费方"这条仓库规则迟早会提出这个问题。这是关于已发布行为的决定，背后有真实的消费方问题，而文档门禁不是做这个决定的地方；本次分类记录的是当下为真的事实。

## Consequences

`pnpm run doc-sync` 变绿：32 个门禁全部通过，`verify-export-jsdoc` 为每个导出名提供文档，`doc-typecheck` 编译 102 个代码块，`verify-doc-graphs` 渲染全部六份图文档，`verify-type-equiv` 将 404 个代码块与其源码对应。

`slot-walk.ts` 中的两个扫描现在会跳过一个名称模式，因此一个本应包含真实 `oxlint-contract-*` 声明的语料不会被索引。该名称被 lint-contract 测试保留给它在同一次运行中删除的探针，覆盖率门禁也以同样方式对待它。

这里没有任何运行时行为改变：文档之外的差异只有 JSDoc、一条 `SERVICE_ROLES` 记录，以及那个扫描过滤器。

## Testing

`scripts/slot-walk.spec.ts` 自带一个临时根目录，覆盖上述三种情形，也就是过滤器所移动的那条边界。其余部分的证据是门禁本身，在最终工作树上运行：`verify-export-jsdoc`、`doc-typecheck`、`verify-doc-graphs`、`verify-type-equiv`、`verify-translation-pairing`（1239 对全部一致）、`verify-md-links`，以及两个被触及包的测试套件（`browser-overlay` 90 个测试、`computer-use` 各套件）。
