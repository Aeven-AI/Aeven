# Agent Note: 修复逐文件 100% 覆盖率门禁所发现的问题，从而关闭该门禁

Status: implemented

[English](2026-09-21-per-file-coverage-gate-closure.md) | 中文

## Problem

`pnpm run test:coverage` 以 100% 语句、分支、函数与行覆盖率执行 `thresholds.perFile`（[vitest.config.ts](../../../../vitest.config.ts)）。在 `83422f9ea5` 上门禁是红的：11 个包组中的 32 个文件未达标，合计携带 391 条未覆盖语句——其中 229 条集中在单个文件 `packages/experimental/browser-overlay/src/overlay.ts`。

当时有三种补救手段：编写测试、添加带理由的 `/* v8 ignore -- <reason> */`，或往 `coverage.exclude` 列表里新增一项。该排除列表本身已带着许多声明要收缩的 `TODO(...)` 条目，因此扩展它会让仓库偏离自己的方向。本注记记录每个缺口各自采用了哪种手段，因为这种选择并不统一：一条未覆盖分支是一个缺陷信号，而以错误方式回应它——无论是排除，还是伪造输入——恰恰掩盖了这个门禁存在的意义。

原始 HTML 报告并不是"哪些文件未达标"的可靠索引。`istanbul-lib-coverage` 的 `CoverageSummary.isEmpty()` 只判断 `lines.total === 0`，随后 `istanbul-reports` 会把此类文件显示出的四项百分比全部强制为 `0`。本次运行中有 138 个文件在四项指标上都显示 `0%`，却通过了门禁。任何靠肉眼读报告的排查，都必须改为从各文件的 `covered/total` 单元格重新计算百分比。

## Decision

这里的补救策略**并非新增**：[质量门禁注记](../process/2026-06-11-quality-gates.zh.md) 已经为 `packages/*/*/src` 设定逐文件 100%，并对不可达的防御性分支采用带理由的 `/* v8 ignore */` 而非删除。本注记记录一次关闭门禁的过程如何应用该策略，以及在哪些情形下应用它并非机械操作。

**测试是默认手段。** 这 32 个文件绝大多数是通过针对公开 seam 编写的行为测试关闭的——`bundle/web-app/src/sign-in.ts` 有 47 条，`overlay.ts` 有 38 条，此前没有任何测试的 `llm/llm-aeven` 有 13 条，等等。

**带理由的 `v8 ignore` 只留给不可达且无法删除的分支。** 它只用于一个文件 `packages/experimental/browser-overlay/src/motion.ts` 的四条记录：两条位于 `ARRIVAL_EPSILON_PX` 提前返回之后（该返回已经保证了它们重新检验的距离）的退化防御分支，以及私有方法中两处 `T | undefined` 收窄分支，其唯一调用点已经检验过该字段。每条都把理由写在指令行上。写下该指令之前，这一判断已从源码独立重算并以实证方式反驳——一次 1,083 个序列的扫描让这四条全部保持冷态。

**当不可达分支本身就是缺陷时，修缺陷。** `packages/llm/llm/src/error.ts` 的 `ENTRIES_OVER_LIMIT` 分支写作 `too\s+many`，缺少结尾的 `\s+`，因此它只可能匹配毫无意义的 `"too manyentries"`，永远匹配不上它自己文档注释所指的措辞。两条未覆盖分支是症状；缺失的量词才是病根。量词已恢复，三个分支各自被直接钉住。正是这一情形证明了该门禁的价值：排除那些分支会把一个活着的错误分类缺陷埋掉。

**不新增 `coverage.exclude` 条目，也不新增阈值。** `vitest.config.ts` 未作改动。

**同一次运行发现的两个相邻缺陷，只在其阻塞门禁之处加以修复。** `sign-in.ts` 中一处多余的收窄分支被删除而非忽略，因为一行解构就能消除对它的需要。包注册与其余四个产品缺陷列在 Consequences 之下。

## Alternatives considered

**扩充 `coverage.exclude`。** 已否决：该列表自身的条目就带着收缩的意图，而且排除对源码文件的下一位读者是不可见的。

**对每处棘手分支都写裸的 `v8 ignore`。** 已被仓库惯例否决（`packages/client/AGENTS.md`：真正不可达的防御性分支要带 `/* v8 ignore -- <reason> */` 注释与真实理由，绝不用裸 ignore），在此就 `error.ts` 这一情形更是被直接否决，因为该分支的不可达性正是那个 bug。

**用测试替身伪造不可能的状态以抵达防御性分支。** 曾被一个工作流采用，且只是暂时接受。`computer-use` 任务／基准中的六条记录是这样抵达的：把 `String.prototype.split` 固定在 `[]`、让 `JSON.parse` 抛出非 `Error`、以及使用一个 `node:fs` 模块替身——没有任何真实输入会产生这些状态。每一条都在 `finally` 中恢复，且该包确有仓库内先例，但该手法断言的是代码不可能被交付到的状态，因此它检验的是替身而不是产者。这六条此后都已由一致的手段取代——与 `motion.ts` 一样，在分支上写带理由的 `v8 ignore`——并改为经由真正的产者触发代码确实会收到的失败（真实的 `ENOENT`、格式错误的 JSON 主体）。它们所揭示的风险，正是质量门禁注记已经点明的那个——100% 覆盖率的压力会产出只断言"某个替身被调用过"的测试——而 [mutation testing](../../proposed/testing/2026-06-11-mutation-testing.zh.md) 是为此规划的对冲。

**为每个工作流重跑整套插桩测试。** 已否决：收窄的 `--coverage.include` 只需数秒，是合适的内循环，但它是保守估计而非权威结论——一个只被别的包的测试套件覆盖的文件，在孤立运行时会显示为未覆盖。只有合并后的分区运行才构成裁决。

## Consequences

**并发的覆盖率运行不得共用同一个报告目录。** Vitest 在每次运行开始时清空其报告目录，因此两次针对同一个默认 `coverage/` 路径的插桩运行会互相摧毁对方的输出，并产生看起来像真实失败的失败。在查明这一点之前，多个工作流因此丢失过运行结果。并行工作必须传入各自不同的 `--coverage.reportsDirectory`。

**`packages/llm/llm-aeven` 现已注册进 `tsconfig.host.json`。** 它先前不在任何一个聚合工程中——在该包没有测试时这是不可见的，因为没有东西把它拉进 program。它的第一个测试文件使聚合工程的 `packages/*/*/tests/**/*.ts` glob 从一个没有任何引用覆盖的工程导入 `src/index.ts`，从而产生 TS6307。注册该包即可消除它；`tsc -p tsconfig.host.json` 现在不再报告错误。

**发现了五个产品缺陷。** 每一个都会改变可观察行为，需要各自独立的变更并配 Agent Note 与快照，而不是在覆盖率任务里顺手打补丁；前四个已按此方式修正，第五个因为在阻塞门禁，就在此修复：

1. `packages/bundle/web-app/src/sign-in.ts` 中的 `signIn()` 在回环监听器绑定失败时永不落定。`startCallbackListener` 构建 `origin` 时只带了 `resolve`，因此服务器的 `error` 处理器拒绝 `callback` 而 `origin` 保持挂起，而 `signIn` 先等待 `origin`。端口被占用、`EMFILE` 或 `EPERM` 会产生挂起而非错误，且 `finally { listener.close() }` 永远抵达不了。
2. `computer-use-windows` 的 `readiness()` 忽略 `WindowsAdapterOptions.powershell`：`src/readiness.ts` 中的三个探针都硬编码 `'powershell'`，因此配置为 `powershell: 'pwsh'` 的适配器会为一个它并未驱动的可执行文件报告就绪。
3. `file.exists` 抛出拒绝而不是报告 false。`@aeven/computer-use-router` 与执行器的 `filesystemHandler` 让 `ENOENT` 逃出 `stat`，尽管其食谱写的是"报告某个路径是否存在"。
4. `packages/experimental/browser-overlay/src/overlay.ts` 中的 `AttachOptions.glideDurationMs` 被构造函数与 `attach()` 存储却从未被读取，因此其文档所述的"设为 0 会禁用滑行并改为直接吸附"行为并不存在。
5. `ENTRIES_OVER_LIMIT`——已在此修复，因为它阻塞了门禁；见 Decision。

**验证。** `AVN_COVERAGE_PARTITIONS=3 pnpm run test:coverage:partitioned`——即 CI 自身所运行的分区数——在 `972ec24a79` 上以 0 退出，没有阈值 `ERROR` 行，也没有未覆盖位置记录。请把退出码重定向到文件来保存它：把该命令管道给 `tail` 报告的是分页器的状态，这在本项工作期间掩盖过一次真正失败的运行。
