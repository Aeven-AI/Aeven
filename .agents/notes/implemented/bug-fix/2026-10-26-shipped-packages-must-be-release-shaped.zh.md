# Agent Note: 发布的包必须具备发布形态

Status: implemented

[English](2026-10-26-shipped-packages-must-be-release-shaped.md) | 中文

<a id="problem"></a>
## 问题

0.3.17-alpha 的桌面发布在完整构建之后，于组装包集合这一步在所有目标上失败：`@aeven/base requires unpacked internal package @aeven/tool-worktrees`。当天早些时候加入 `packages/session/` 的 `@aeven/worktrees` 与 `@aeven/tool-worktrees` 带有 `private: true`、导出 `./src/index.ts`、且没有 README，而 `@aeven/base` 依赖两者。[`scripts/release/families.ts`](../../../../scripts/release/families.ts) 在组成 `avn` 发布集合时跳过私有包，因此 `release:pack --family avn` 从不生成它们的 tarball，而 [`apps/desktop/scripts/prepare-package-set.ts`](../../../../apps/desktop/scripts/prepare-package-set.ts) 会拒绝含有未打包 `@aeven/` 依赖的闭包。这些包合并时与版本号提升时，都没有任何检查提出异议。

<a id="decision"></a>
## 决定

`packages/` 下除 `packages/experimental/` 之外的每个包都属于 `avn` 发布家族，因此会发布的包必须具备发布形态：不得带有 `private: true`，要有 `publishConfig.access: public`、`repository.directory`、指向 `lib/` 的 `main`、`types` 与 `exports`、列出构建产物的 `files`、`license`，以及双语 README 三件套。[`@aeven/worktrees`](../../../../packages/session/worktrees/package.json) 与 [`@aeven/tool-worktrees`](../../../../packages/session/tool-worktrees/package.json) 现在具备该形态，与同批交付工作目录特性的 [`@aeven/tool-working-directory`](../../../../packages/session/tool-working-directory/package.json) 一致。

私有包在构造上就不可发布，因此被已发布 bundle 依赖的包不能是私有的：桌面包集合要求闭包中每个 `@aeven/` 依赖都以 tarball 形式到达，而发布家族跳过私有成员。`packages/experimental/` 保持私有，因为发布完全排除它。

<a id="alternatives-considered"></a>
## 考虑过的替代方案

**保留两个包的私有状态并把它们并入 bundle。** 这避免发布两个小包，但 bundle 的 patch 层按包名指定插件包，Loader 仍须从某处解析它们；而并入 `@aeven/base` 会让一个包拥有工作树代码，而工作目录那一对却保持分离。

**放宽桌面包闭包检查，跳过未打包的 `@aeven/` 依赖。** 该检查正是把缺失的 tarball 变成具名错误、而不是让桌面应用在运行时失败的东西，放宽它只是把失败从发布日志搬到用户机器上。

**在 CI 中增加拒绝私有包或源码入口包的检查。** 这是持久性的预防，属于推迟而非否决：该检查需要把发布家族自身的成员规则作为唯一来源，而 [`scripts/release/families.spec.ts`](../../../../scripts/release/families.spec.ts) 已经在读取它。

<a id="consequences"></a>
## 后果

目前，形态不符合发布要求的包最先在发布时暴露，且是在每个目标完成完整构建之后才暴露。在检查覆盖它之前，新增包意味着对照最近已发布的同侪来核对，而不是对照按设计保持私有的 experimental 包。

两个包现在发布 `lib/` 入口，因此工作区自身的测试与源码启动路径继续通过 tsconfig 路径解析 `./src/index.ts`，而 npm 消费者收到构建后的 JavaScript。它们的 README 陈述了模型可见的工具文本，以及两者都不发布 `./invariant` 伴随入口的理由。
