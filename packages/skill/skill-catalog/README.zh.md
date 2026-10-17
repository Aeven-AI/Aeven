---
description: "内置技能目录：按分类浏览随发行版附带的技能，并将其中一个安装到账户。"
kind: "package-reference"
---

# @aeven/skill-catalog

[English](README.md) | 中文

## 概述

每个发行版都会在此包内附带一份技能目录：上游 `davila7/claude-code-templates` 集合中经评审的高价值子集，加上为本仓库编写、覆盖该集合未涉及目标的技能（目前为 `reverse-engineering`），以一份索引加每个技能一个 zip 的形式存放。设置页面可按标题顺序浏览整份目录，或按分类分组浏览并搜索，将选中的技能安装到已登录账户自己的库中。在有人安装之前，目录内容不会到达模型。

宿主在运行时不获取任何内容：索引与包内文件都通过 `ctx.skillCatalog` 从磁盘读取。安装会把内置 zip 交给账户原有的导入路径，因此路径校验、大小上限、资源存储与目录失效行为与手动上传完全一致。

## 目录

- [Use this package](#use-this-package)
- [Understand the implementation](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----


<a id="use-this-package"></a>
## Use this package

Web 应用 bundle 将此插件与 [`@aeven/host-account-integrations`](../../host/account-integrations/README.zh.md) 一起挂载；后者通过 `catalog()` 与 `installCatalogSkill()` 把目录提供给设置页面并执行安装。移除该组合行会移除“技能目录”视图，技能页其余部分不受影响。

账户尚未安装任何技能时，技能目录是技能页默认显示的一半；页面顶部的一个切换在“你的技能”与“技能目录”之间切换。

-----


<a id="understand-the-implementation"></a>
## Understand the implementation

<details>
<summary>实现细节 — 点击展开</summary>

`scripts/sync-skill-catalog.ts` 在准备发行版时重新生成目录，从不在运行中的部署里执行。一次运行固定一个上游提交，下载评价值达到 `curation.json` 中 `minValue` 的技能，并写出 `catalog/index.json`、`catalog/bundles/<category>/<name>.zip` 与 `catalog/MANIFEST.md`。

安装名取自上游目录名，也就是技能注册表要求的 kebab-case 标识；两个技能共用的基名会加上其分类前缀，同一分类内两个技能共用的名字则退回整条上游路径。每个内置 `SKILL.md` 的 frontmatter 都带有同一个名字，因此包与索引一致。嵌套在另一技能目录内的技能会作为独立条目打包，并从父技能的包中排除。

`SkillCatalog.list()` 每个进程解析一次 `index.json`。`SkillCatalog.bundle(name)` 读取一个 zip，并返回账户 Remote 已接受的“文件名 + base64”上传结构。`catalogDir` 可把服务指向其他目录，用于派生的目录或测试夹具。

`catalog/sources.json` 列出集合未收录的技能：每条都指明本仓库中存放该技能 `SKILL.md` 的目录，并写明设置页面对它使用的分类。同步按打包内置技能的方式处理这些技能，把它们记录进 `index.json` 与 `MANIFEST.md`，并按目录当前内容生成包，因此改写该目录并重新同步即可进入下一次发行。

</details>

-----


<a id="model-experience"></a>
## Model Experience

None, as 此包只读取随发行版附带的目录，并把一个包交给账户导入路径。

#### KV Cache effect

此处不进入模型请求，因此在已安装技能进入目录之前不影响提供方缓存复用。

-----


## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **是快照而非订阅源。** 上游变更需要在发行时重新生成目录；热度数字停留在内置时的取值。在此编写的技能只在其目录发生变化并重新同步时才更新。
- **上游指令原样内置。** 其中一些提到 Claude Code 的界面，或部署可能并不具备的 Python、Node 工具，安装时不会改写。
- **无 invariant 伴随模块**——不发布 invariant 伴随模块，因为该服务只读取一份不可变的文件集合，且没有第二套注册表，因此不存在可独立观测的关系。

-----


### 开发备注

<a id="dev-note"></a>

<a id="开发备注"></a>


<details>
<summary>维护者上下文 — 点击展开</summary>

用 `pnpm exec tsx scripts/sync-skill-catalog.ts` 重新生成；该命令需要网络访问与 `zip` 命令行工具。生成的 `catalog/` 目录属于数据而非源码：它被排除在 Markdown 文档门禁之外。

</details>
