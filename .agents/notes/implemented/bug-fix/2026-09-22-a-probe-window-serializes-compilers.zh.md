# Agent Note: 用探针窗口把 Oxlint 探针与编译器串行化

Status: implemented

[English](2026-09-22-a-probe-window-serializes-compilers.md) | 中文

## Problem

`pnpm run check:all` 中 `build` 门禁在 `test` 门禁同时运行时失败：

```
error TS6053: File '.../apps/cli/tests/profiles/headless/tests/oxlint-contract-69111ccb-....ts' not found.
  The file is in the program because:
    Matched by include pattern 'apps/cli/tests/**/*.ts' in 'tsconfig.host.json'
```

`scripts/oxlint-contract.spec.ts` 要证明每个文件类归属哪个 TypeScript 工程，因此探针必须写在它所断言的那条路径上——正好落在 `tsc -b` 所构建程序的 `include` 通配符内。若某程序读到目录时探针还在、真正读取文件时探针已被删除，就会报上述错误。竞态不是偶发：探针在整个 Oxlint 调用期间存在，而 `run-gates` 并发执行 `test` 与 `build` 门禁。

按以下方式可稳定复现：启动 `tsc -b tsconfig.host.json` 后按固定延迟删除探针，500 ms、900 ms、1700 ms、2200 ms 四次都报 TS6053（5 次中 4 次失败）；1300 ms 那次因为目录读取发生在删除之后而逃过。

四种"改配置"的思路各自都有实测失败原因：

- 在 `tsconfig.host.json` 里加 `exclude`：Oxlint 的工程匹配遵循 `exclude`，探针解析为 `<none>`，被测对象本身消失（`Got tsconfig for file ...: <none>`、`Unmatched file`）。
- 在同一父目录下用点号隐藏目录：TypeScript 的 include 匹配跳过点目录，探针对编译器不可见，对 Oxlint 的匹配器同样不可见。
- `tsc --excludeFiles`（TypeScript 6）：它管的是监视模式而非程序成员，探针照旧被编译并报出自身错误。
- 用被忽略的模式命名探针：该忽略列表正是契约配置要清空的东西，也无法把两类读取者分开。

## Decision

两侧共用同一个独占窗口。`scripts/transient-probe-window.ts` 提供 `withTransientProbeWindow`，复用 `@aeven/atomic-write` 的 `withFileLock`（`wx` 独占创建、指数退避、有上限等待），并回收记录进程已不存在的锁，使被杀的闸门不会堵住后续所有构建。`scripts/run-tsc.ts` 在整次编译期间持有同一窗口，`build:lib:host`、`build:lib:client`、`typecheck:contracts-ready` 都经由它运行。Oxlint 契约 spec 中每个写探针的用例现在都跑在窗口内。

## Alternatives considered

把探针从程序中排除的四种形态都已在 Problem 中实测并否决：`exclude` 会去掉该 spec 所断言的映射；隐藏目录对两类匹配器同时隐身；`--excludeFiles` 不影响程序成员；忽略模式正是契约配置要清空的东西。把配置树镜像到私有根目录也试过：Oxlint 会把聚合工程判为不认领（`Got tsconfig for file ...: <none>`、`Unmatched file`），因为聚合投影不认领仓库树之外的文件，于是该 spec 断言的将是副本的行为而非仓库自身的行为。

在调度器里把 `test` 与 `build` 门禁串行化可以在不改 spec 的前提下消除重叠，但代价是让整个 200 s 的 `test` 门禁进入所有依赖 `build` 的门禁的关键路径，而这一切只为一个 fixture。仅当构建失败信息里只有探针形状的 TS6053 时重试构建被否决，因为它属于掩盖问题：探针在各次运行中的存在时间相同，第二次尝试并不比第一次更可能成功。

## Consequences

- 编译器不会读到探针正在经过的目录，探针窗口也不会在编译进行时打开。代价是重叠而非额外工作：竞争者等待对方（实测窗口持有 0.5 s、0.9 s、1.7 s、2.2 s 时，编译器耗时分别为 1.8 s、2.0 s、2.9 s、3.3 s）。
- 锁文件是仓库根目录的 `.avn-transient-probes.lock`，与探针文件一样被 gitignore。两侧最长等待十五分钟，即编译器自身运行时间量级；记录进程号使被遗弃的锁无需人工介入即可恢复。
- 探针仍留在契约所要求的位置，因此该 spec 证明的是真实工程映射，而不是一份镜像副本。
- `doc-typecheck` 与 `verify-node-next-types` 用文档抽取文件构建自己的程序，不读测试树，因此未接入该运行器。
- 证据：裸跑 5 次中 4 次 TS6053，加窗口后 5 次全通过；`scripts/transient-probe-window.spec.ts` 固定锁的释放、等待与死持有者回收，`scripts/run-tsc.spec.ts` 用屏障证明编译器只在窗口关闭后启动。
