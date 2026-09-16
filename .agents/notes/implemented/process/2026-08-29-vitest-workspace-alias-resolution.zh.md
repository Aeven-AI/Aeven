# Agent Note: Vitest 通过别名解析工作区标识符

Status: implemented

[English](2026-08-29-vitest-workspace-alias-resolution.md) | 中文

## 问题

每个 Vitest 配置都把 `vite-tsconfig-paths` 指向 `tsconfig.base.json`，用以把 `@deepseek-ai/*` 标识符解析到 `src`。Vite 如今自身即可完成 tsconfig 路径解析，因此该插件重复了打包器的工作；而它之所以奏效，只因该文件未声明 `include`：插件把无 include 的 project 读作全量匹配。仓库依赖的是一处缺失——这正是 `tsconfig.base.json` 长期背负着"永不添加 `include` 或 `files`"这条禁令的原因。

把该插件换成 `resolve.tsconfigPaths: true` 读起来是同一种解析，实则不是，有两点，且均在 `packages/api/session-controller`、`packages/api/workspace-controller` 与 `packages/session-query/session-log-export` 的用例上实测。

原生解析是拿文件去匹配最近的 project，而非一个全量匹配门面，因此五个无人声明的仅测试用 import 彻底解析不到了——session-controller 中的 `dsh-system-prompt`、`dsh-jobs-local` 与 `dsh-commands`，workspace-controller 中的 `dsh-storage`，以及 session-log-export 中的 `cordis-plugin-include`。一直是那个全量匹配门面在供给它们；此外从来没有别的东西供给过。

原生 tsconfig paths 还是在包解析**之后**才运行，而不是之前。于是只要构建产物存在，工作区标识符就会经 pnpm 符号链接与包自身的 `exports` 解析，`paths` 根本轮不上。`@aeven/typert-protocol` 从 `packages/typert/protocol/lib/index.js` 与同一模块的 `src` 并存地加载，于是每个类与服务单例同时存在两份副本：48 个测试因跨副本的 `instanceof` 而失败，且带类型的失败退化为 `'internal'`，因为识别它们的那条分支没命中。

## 决策

**`vitest.shared.ts` 中的 `workspaceAliases()` 就是解析器，每个 Vitest 配置都设置 `resolve: { alias: workspaceAliases() }`。** 别名是唯一能压过包 `exports` 的形式；`paths` 映射所要堵上的那道制品面泄漏，不是原生解析靠配置能绕开的。`vitest.config.ts` 内部每个 project 都重复该选项，因为 project 的 `resolve` 不继承根配置的。

**别名映射由 `tsconfig.base.json` 生成，绝不手工维护。** 该文件是仓库中唯一声明 `paths` 的配置，其 524 条条目即是测试文件可解析范围的全部，而第二份副本会与写出第一份的生成器发生漂移。每条条目变为一个与 TypeScript 匹配范围完全一致的锚定模式——字面 key 用 `^key$`，通配 key 用 `^prefix(.*)suffix$`——且精确模式排在通配模式之前，因为 Vite 取第一条命中的别名，而 TypeScript 偏好更具体的 key。

**测试文件发起的 import，就是其所属包要声明的依赖。** 那五个未声明标识符现已作为 `workspace:^` 的 `devDependencies` 存在。它们一直都是依赖，只是被门面的宽度掩盖了；而一个会掩盖缺失声明的解析器，等于由它来决定仓库何时才发现问题。

## 测试

实测该回归的那三套用例现有 507 个测试全绿，而被其取代的那棵树是 496 个测试中 8 个失败。完整单元套件收尾时只剩 8 个既有的 `subagent-claude-code` real-product 失败——它们在纯净检出上同样复现——再无其他可归因于解析的失败。

模块同一性是直接断言的，而非借助解析器探针：`import.meta.resolve` 由 Node 的解析器作答，无论如何都报 `lib`，因此真正能区分一份副本与两份副本的，是一个测试同时以包标识符和相对源码路径 import 同一个导出，并断言两者是同一个值。

## 考虑过的替代方案

**在别名之下保留 `resolve.tsconfigPaths: true`。** 被否决：在别名映射完整的前提下，该原生选项永远解析不到任何东西，而一个总是落败的第二解析器，就是留给读者去调和的第二个事实来源。优先级正是本 Note 的全部主题；在配置里留一个沉默的败者只会遮蔽它。

**给每个包加一个 `source` 导出条件，并把条件顺序排在 `import` 之前。** 这样经包解析本身即可解析到 `src`，无需别名映射，且答案由随发行的 `exports` 携带。被否决：这要改动 200 多份包清单，去为工具链陈述 `paths` 已经陈述过的事；而一个解析到 TypeScript 源码的条件，是发布给每个消费方的一张面，而非测试通道的设置。

**退回 `vite-tsconfig-paths`。** 被否决：该插件的正确性依赖于 `tsconfig.base.json` 永不获得 `include`，而这条不变量没有任何门禁在守，读者也没有理由预期到它。别名映射不在乎该文件的 `include` 写了什么，那条禁令只为继承它的编译器 project 而存续——在那里它的字面含义就是它的实际含义。

## 影响

`tsconfig.base.json` 不再是解析门面，而回归为一份由构建步骤读取的普通编译器配置。它的注释不再警告全量匹配范围，而描述旧解析器的两篇 Agent Note——[显式工作区路径别名](2026-08-27-explicit-workspace-path-aliases.zh.md)与[双聚合 solution 根](2026-07-22-tsconfig-solution-root-two-aggregates.zh.md)——改为指明这份别名映射。

新增包仍需运行 `pnpm run gen-tsconfig-paths`，而如今测试通道所经的正是那份生成的映射：映射中缺失的包，在测试通道下会解析到构建好的 `lib/`，与它在 `tsc` 下的表现完全一致，因此该门禁已有的覆盖断言同样覆盖了这一点。

仓库以拥有 50 行解析器代码，换掉了拥有一个依赖。这笔交换是有意为之：代码很小，其行为陈述于一处，并且它了结了一个此前由依赖顺带答复的优先级问题。
