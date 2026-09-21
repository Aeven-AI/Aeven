# Agent Note: DeepSeek 与 Aeven 两条 LLM 路由之间共享的路由词汇

Status: implemented

[English](2026-09-21-shared-route-vocabulary-llm-aeven-deepseek.md) | 中文

## Problem

`@aeven/llm-aeven` 是 Aeven 网关路由：同一个 `DeepSeekAdapter` 传输层，以 `aeven-cloud` 这个 provider key 注册，跑在 Aeven 自己的身份权威之上。它是从 `@aeven/llm-deepseek` 分叉出来的，而这次分叉带走了三样本属于适配器和注册表、并不属于任何一条路由的东西的副本：catalog 条目 schema、插件配置 schema 的连接字段词汇，以及"发布一条可配置路由并回答它的模型清单"的注册仪式。重复门禁（`pnpm run duplication`，jscpd，`exitCode: 1`）把这三处都报成了跨文件克隆。

每一份副本都是两条路由可以悄悄彼此漂移的地方。给适配器的连接事实加一个字段、改动 catalog schema 的校验、或者改动一条路由被宣告的方式，都只会到达被改动的那条路由而不会到达另一条，而且什么都不会失败——两边的 schema 只是描述了不同的集合。这些副本也不能随便去掉：每条路由的配置 schema 都是受门禁保护的文档产物，会被逐字粘贴进 `docs/config-catalog.md`，而生成它的脚本是把导出的 `Config` 当作字面量的 schemastery 调用来遍历的。

## Decision

注册仪式是共享的。`@aeven/llm-deepseek` 导出 `registerProviderRoute(ctx, route)`，它为一条路由执行 `registerConfigurableProviders`，然后用 `registerModelDiscovery` 以该路由已经宣告的 catalog（而不是实时 listing）作答——这个作答正是该辅助函数承载的决策，因为 provider 的 listing 是按权限范围裁剪的，披露的信息严格少于路由自己发布的条目。`@aeven/llm-aeven` 用它自己的 provider key、显示名、设置命名空间和 catalog 来源调用它。`@aeven/llm-deepseek` 本来就是 `@aeven/llm-aeven` 的 `devDependencies` 与 `peerDependencies` 条目，而且 Aeven 路由本来就继承 `DeepSeekAdapter`，所以没有任何 manifest 发生改动。

两个 schema 保持字面量，每条路由各一份。配置目录生成器（`scripts/gen-config-catalog.ts`）为导出的 `Config` 声明里的每个赋值收集一条顶层键或嵌套路径：它认得 `z.object({…})`（可以隔着链式精化）与 `z.intersect([…])`，对其它任何形式直接硬报错，因为一个它看不见的 schema 会悄悄把 `docs/config-catalog.md` 变薄，而不是让门禁失败。由工厂构造出来的 `Config` 对它是不可见的，而展开运算符会把共享字段路径从生成页面里丢掉。因此 `catalogModel` 与 `Config` 在两条路由里都仍然是 `z.object({…})` 字面量，和它们原来一样。

剩下这两份副本被包在重复门禁政策允许的例外里。`/* jscpd:ignore-start -- <reason> */` … `/* jscpd:ignore-end */` 只包住被重复的赋值列表——每个文件里的 catalog 条目 schema 与连接字段块——理由中同时点名两个 owner 并指向本文档，而且它绝不覆盖 `Config` 接口、路由自己的默认值、它的凭据解析或任何周边逻辑。`.jscpd.json` 没有新增任何条目。

每条路由保留它真正不同的部分：默认模型 catalog、thinking 与 effort 默认值、它的 endpoint 与凭据字段、它的 `resolveApiKey` 以及它的错误文案。`AevenAdapter`、已发布的 `DEFAULT_MODELS` 以及两个 `Config` 接口都没有被改动，`docs/config-catalog.md` 里 `@aeven/llm-aeven` 与 `@aeven/llm-deepseek` 两节也保持不变。

## Alternatives considered

**用一个共享工厂构造两边的 schema。** 这正是读者对"同一套词汇只声明一次"的期待，而且它能彻底消掉两份副本：在 `llm-deepseek` 里放一个拥有连接字段的工厂，用路由自己的 `thinking`、`reasoningEffort`、`models` schema 作参数。它输给了配置目录门禁。接受工厂就意味着要教会生成器遍历任意函数调用——跟进另一个包、把它的参数解析回某条路由自己的值——这会让生成页面依赖于分析器是否理解每个工厂的契约，也会让分析器跟不上的 schema 变成受门禁产物里的一个静默空洞。字面量也正是生成页面可读的原因：`docs/config-catalog.md` 展示的是每条路由自己的代码。

**用 `z.intersect([shared, routeOwned])` 组合 schema。** 生成器本来就认得 `intersect`，所以这是它唯一接受的组合方式。它输在了生成出来的 schema 上：根节点会变成带 `list` 的 `type: 'intersect'`，而不是带 `dict` 的 `type: 'object'`，而设置界面遍历的是 object 节点（`packages/client/ui-settings/src/client/schema.ts` 的 `nodeAtPath` 读 `node.dict`），因此这条路由的配置字段会不再渲染——这是在这个 schema 所属的界面里一次静默的回归。它还会把这些字段路径从目录页面里丢掉。

**把整个配置块（连工厂调用一起）用忽略区间标记，并保留工厂。** 改动更小，门禁也能过。它落选是因为那样区间就会覆盖路由自己的默认值与 endpoint 字段，而不是被重复的赋值列表，这恰恰是这个例外不该做的事。

**只共享 catalog 条目 schema，留下连接字段那份副本。** 改动更小，而且能清掉一处克隆。它落选是因为连接词汇才是第二份副本真正会漂移的地方：加在 `DeepSeekConnectionOptions` 上的一个旋钮会出现在一条路由的 schema 里而不出现在另一条里，而且只有请求期的拒绝会说出来。

## Consequences

- 注册仪式与"以 catalog 作答的模型发现"现在只声明一次，一条路由无法只宣告设置命名空间而不回答它的模型清单。
- 两份 schema 副本仍然存在，因此它们允许的漂移现在是一个被记录下来的决定，而不再是意外。例外只包住赋值列表并点名两个 owner，所以改动其中一个块的读者会被告知另一个块的存在；重复门禁对它们保持沉默。
- 两条路由都需要的字段仍然要改两个文件。配置目录门禁就是让两者保持同步的东西，因为两份都是受门禁保护的产物。
- 两个字面量都保持可遍历，所以生成器干净退出而不是报违规，两条路由生成出来的目录小节与本次改动之前逐字节一致。
- 将来若有人改动配置目录生成器——让它能跟进工厂调用——工厂方案就可以落地；除此之外没有别的阻碍。
