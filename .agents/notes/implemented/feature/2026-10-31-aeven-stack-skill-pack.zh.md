# Agent Note: 技能目录发行 aeven-stack 技能包

Status: implemented

[English](2026-10-31-aeven-stack-skill-pack.md) | 中文

## 问题

技能目录里没有任何通用的工作方法技能：它发行的是领域技能（设计、安全、动效、文档处理）以及两份本仓库编写的逆向工程技能，因此一个需要“先规划、再验证、再复审”纪律的会话没有可安装的东西。第三方技能包 `aicodeking/deepseek-stack` 正好补上这个缺口，共 29 个技能，每个都是一个带停止条件、并要求证据的循环。它是为另一家模型厂商写的：`ds-` 前缀的名字、关于该模型的论断、帮助技能里的路由表，以及它对那家厂商目录的引用，指的都是 Aeven 并不存在的东西。

## 决策

**该技能包以 29 条本仓库编写的来源、归入同一个分类发行。** 每个技能都位于 `packages/skill/skill-catalog/authored/<name>/SKILL.md`，并在 `catalog/sources.json` 中列在 `aeven-stack` 分类下，于是设置页面为整个包显示一行，而不是散落的 29 行。移植保留上游的循环、停止条件与规则原文，只改身份与宿主事实。`sources.json` 这套机制本身由[未收录来源的记录](../process/2026-10-17-skill-catalog-extra-sources.md)负责说明，维护路径与该[逆向工程技能](2026-10-17-authored-reverse-engineering-skill.md)相同。

**命名遵循 `avn-` 前缀，入口技能叫 `aeven-stack`。** `ds-adopt` 安装为 `avn-adopt`，其余 28 个同理，沿用仓库既有的 `avn-` 技能命名。该包的路由技能——上游的 `ds-help`，负责回答“这些里哪个适合我的任务”——安装为 `aeven-stack`，于是这个包有一个以自己命名的入口。没有任何 `avn-` 名字与 `.agents/skills/` 下的仓库技能或目录中内置的名字相撞。

**移植改写了关于另一家厂商的每一处事实。** `ds-` 交叉引用改为 `avn-`，“<厂商> 足够便宜”改为对产物本身的陈述而不是对模型的陈述，“宿主的提问工具”改为 Aeven 的提问工具，凡是提供“第二个 CLI，例如 Codex 或 Claude”的地方，改为以 `avn` 的另一个 profile、带模型设置的子代理，或其他厂商的 CLI 命名。关于模型的论断被删除而不是换成某个 Aeven 模型名，因为这些技能推理的是成本与审阅者，而不是某个具体模型的行为。

**上游的 MIT 声明随每个移植后的技能一起发行。** `scripts/sync-skill-catalog.ts` 会给内置包补上仓库的 `LICENSE`，但不会给本仓库编写的技能补，因此这 29 个目录都在 `SKILL.md` 旁带上上游 `LICENSE`，每个包再分发时都随附它有义务提供的声明。

## 验证

`pnpm exec tsx scripts/sync-skill-catalog.ts --ref 8293bc3e6130e49391c1a3530cd73212f01aec83` 重新生成了 `catalog/index.json`、`catalog/MANIFEST.md` 与每个技能一个 zip：14 个分类共 99 个技能，其中 `aeven-stack` 占 29 个。29 个包逐一解压，把 frontmatter 的 `name:` 与文件名比对：全部一致，`avn-watch-pr.zip` 另带 `scripts/watch_pr.py`。对 `aeven-stack` 各目录执行 `grep -rniE "ds-[a-z]|deepseek|/ds-"` 无任何结果。

## 考虑过的替代方案

**通过 `catalog/vendored.json` 引入该技能包。** 否决：那条路径按仓库现状下载文件，会带来技能注册表接受、但本仓库不用的 `ds-` 名字，并且记录一条来源路径，而不是发行本仓库维护的改写文本。

**保留 `ds-` 名字，以便与上游逐条对应。** 否决：前缀正是读者在目录列表里第一眼看到的东西，而该包自己的路由表会因此在同一段里混用两套词汇。

**按领域拆成多个分类（规划、复审、发布）。** 否决：这个包是作为一个整体被安装和理解的，拆开只会让路由技能与它所路由的技能分家。

**把该包的路由技能留作 `avn-help`。** 否决：`aeven-stack` 以读者寻找这个包的方式命名入口，而且目录中没有其他技能使用本产品自己的名字。

## 后果

- 扩大或撤下这个包，仍是一次 `sources.json` 编辑加上重新运行同步；给它加一个技能，则是一个 `authored/<name>/` 目录、一行 `sources.json`，以及 `aeven-stack` 路由表里的一行。
- 这次移植是复制而不是内置来源：上游的改进不会随同步到来，只有有人读到上游文件并移植过来时才会到来。
- 这些技能点名了今天确实存在的 Aeven 机制（子代理、workflow 工具、提问工具、后台任务）。其中任何一个界面改变，对应的技能就会过期。
