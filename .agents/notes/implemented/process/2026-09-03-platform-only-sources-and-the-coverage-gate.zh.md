# Agent Note：单平台源码独立成模块，好让其他宿主也能跑覆盖率闸门

Status: implemented

[English](2026-09-03-platform-only-sources-and-the-coverage-gate.md) | 中文

## 问题

在 macOS 上，无论哪个分支、即便工作树干净，逐文件 100% 覆盖率闸门都无法通过。

`readProcessStart` 读取 `/proc/<pid>/stat` 的第 22 个字段，而该路径只存在于 Linux。在 Darwin 上，函数在 `process.platform !== 'linux'` 的守卫处返回，其下的五条语句从不执行。这五条正是整个仓库仅有的未覆盖语句——53,574 中的 53,569 条已覆盖——它们把 `packages/experimental/code-runtime-python/src/index.ts` 压在 99.15%，未达阈值并以 1 退出。

CI 从未发现：覆盖率通道只有 Linux 与 Windows，而 Windows 因该包的测试需要 bash 与 Python 而整包排除。`vitest.config.ts` 本就在相反方向携带了同一套机制——`windowsOnlyCoverageExclusions` 会在非 Windows 通道上排除仅 win32 的源码——因此 Linux 方向的缺失是遗漏而非决策。其后果是：维护者在推送前运行 `pnpm run test:coverage`，读到的是并非自己改动造成的失败，而闸门正是这样一步步变得无人阅读。

## 决策

**其函数体只在单一平台执行的源码独立成一个模块，并由 `vitest.config.ts` 在其他所有平台上将该模块排除出覆盖率统计。**

`readProcessStart` 迁至 `packages/experimental/code-runtime-python/src/process-start.ts`，`linuxOnlyCoverageExclusions` 在 `process.platform !== 'linux'` 时排除该路径。`src/index.ts` 重新导出该函数，因此本包的公开表面与其调用方均未改变。

以模块为单位，是因为 vitest 覆盖率的 `exclude` 接受的正是模块。若改为扩大既有的 `v8 ignore` 以覆盖这段读取，则会连 Linux 通道一并抑制，而 `tests/runtime-budgets.spec.ts` 在那里确实覆盖了它们——那是拿一道生效的闸门去换本地的便利。

## 影响

`pnpm run test:coverage` 现在能在干净工作树的 Darwin 上通过，因此该闸门在三个开发平台上都可用作本地推送前检查。

在非 Linux 宿主上，`process-start.ts` 整体不被度量，包括在该平台确实会执行的 Darwin 分支。该分支只有一条 `return undefined`，并由 `runtime-budgets.spec.ts` 的非 Linux 分支断言，因此失去的是一个覆盖率数字，而不是一项测试。

排除模式如今在两个方向上都成立；第三个平台特定的源码同样应当独立成模块，而不是套上一条宽泛的 ignore 注释。这条规则的代价是每个此类源码多出一个模块；这正是让其周围文件保持在完整标准之下所要付的价。

`readProcessStart` 仍从包入口导出。日后在 `index.ts` 中寻找它的读者会看到重新导出，以及指向这次拆分的注释。

## 验证

本备注所依据的证据，是在 Darwin 上前后两次运行 `pnpm run test:coverage`。之前：53,569/53,574 条语句，一个文件低于阈值，以 1 退出。之后：语句、分支、函数与行均为 100%，以 0 退出。

该包自身的测试套件维持在 283 通过、2 跳过不变，这正是表明此次迁移保持行为不变的依据。`pnpm run typecheck`、`pnpm run lint` 与 15 项文档闸门均通过。

Linux 通道在构造上不受影响：`process.platform === 'linux'` 时 `linuxOnlyCoverageExclusions` 为空，因此在这些行确实可达之处，该文件仍处于逐文件标准之下。

## 备选方案

**在非 Linux 宿主上排除 `src/index.ts`。** 否决：这会让 macOS 确实能覆盖的两千余行离开闸门，其缺口远大于所要弥合的那个。

**扩大 `v8 ignore` 注释以覆盖 `/proc` 读取。** 否决：该注释是静态的，因此会同样蒙蔽 Linux 通道，并让第 22 字段解析的真实覆盖退场。

**为 CI 增加一条 macOS 覆盖率通道。** 否决：macOS 通道同样触达不到这些行，因此它在能够通过之前仍需要这同一条排除。它是保留该规则的理由，而非替代它的方案。

**注入文件读取器，好让 Darwin 测试驱动这段解析。** 否决：那是为了一个覆盖率数字而给拆除路径上的探针增加参数，并且它验证的将是针对固定装置的解析，而非针对真实 `/proc` 条目——而后者才是值得测试的部分。
