# Agent Note: 在根配置中一次性声明 Vitest 项目共享选项

Status: implemented

[English](2026-11-28-vitest-5-root-declared-project-options.md) | 中文

## 问题

单元测试套件在 Vitest 4.1.8 上于一台 12 核 macOS 主机运行需 144 秒，而 Vitest 5 对隔离的 fork 池更快。Vitest 5 还改变了 `vitest.config.ts` 的解析方式：内联项目现在会继承声明它的配置文件，且 Vite 在合并时会拼接数组选项。4.x 配置在根配置和两个项目中重复声明了 `resolve.alias`、`plugins`、`setupFiles`、`pool`、`execArgv`、`include` 和 `exclude`，因为 4.x 项目不会继承这些选项。在 5.x 下，这种重复会让每个 setup 文件和插件执行两次，并把根配置的 `include` 加到每个项目上，导致 `process-bound` 收集整个测试清单。

## 决策

仓库使用 Vitest 5.1.2。根 `test` 配置声明 `thread-safe` 与 `process-bound` 项目共享的全部选项：别名、标准装饰器插件、`execArgv`、`pool: 'forks'`、`setupFiles`，以及平台、主机权限和覆盖率豁免的排除项。每个项目只声明 `name`、`include` 和它自己额外的 `exclude`。根配置不声明 `include`，因此项目的文件集合恰好是它自己的 `include`。`vitest list --filesOnly` 解析出的文件与 4.1.8 相同：`thread-safe` 1461 个，`process-bound` 7 个。

Vitest 5 默认启用文件系统模块缓存（`fsModuleCache`），因此配置不再设置它。`test:snapshot:record` 传入 `--update=all` 而非单独的 `--update`，因为 5.x 的 `--update [type]` 会吞掉下一个参数，并把任何无法识别的值解析为 `all`，从而把追加的文件过滤器变成全套件更新。

Vitest 5 更严格的检查要求修正三处测试：未 await 的 `.rejects` 断言现在会使测试失败；`expect.poll` 会向回调传入 `{ signal }`（因此带可选参数的读取函数需要包一层）；自定义匹配器的 `Assertion` 声明合并改用双参数的 `Assertion<R, T>`。Vitest 5 去掉了 `test.each`/`test.for` 标题占位符中字符串值的引号，因此基于这些标题生成的快照键被重命名，值保持不变。

## Alternatives considered

- **在每个项目上设置 `extends: false`。** 未采用：它保留了 4.x 的重复，新增 setup 文件或排除项仍需修改三处，而且各项目将无法共享 5.x 为继承项目创建的根 Vite 服务器。
- **为 `thread-safe` 使用非隔离 worker（`isolate: false`）。** 已在 4.1.8 上实测并否决。在同一 worker 中连续运行多个文件可达到 114–122 秒，但七次完整运行各自暴露出不同的跨文件泄漏。泄漏来源包括：模块 mock 注册前模块已被加载、jsdom window 在文件间复用、Node 环境的客户端测试直接赋值浏览器全局变量、Host 注册表，以及 koffi 类型名被重复注册。其中一次运行因 worker 耗尽堆内存而中止。
- **停留在 4.1.8。** 未采用：4.x 只接收维护版本，而 5.x 的模块缓存和共享项目服务器能减少每次运行都要付出的转换开销。

## Consequences

在同一台主机上，完整单元测试套件在升级后首次运行耗时 138 秒，下一次运行（模块缓存已预热）耗时 128 秒，而 4.1.8 为 144 秒。添加到根 `test` 配置的选项现在会作用于每个项目。只针对某个项目的选项必须声明在该项目上，且其中的数组选项会追加到根配置的值之后，而不是替换它。用于比较不同 pool 与隔离设置的 `vitest doctor` 未能给出建议，因为另一次完整运行占用主机时，一个较重的流式测试超时。它需要在空闲的机器上运行。
