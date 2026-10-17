# Agent Note: The skill catalog vendors skills from other repositories

Status: implemented

[English](2026-10-17-skill-catalog-vendors-skills-from-other-repositories.md) | 中文

## Problem

随发行版发布的目录此前只有两种来源：`davila7/claude-code-templates` 中经评审的子集，以及由 `catalog/sources.json` 按目录指明的、为本仓库编写的技能。因此，以相同 `SKILL.md` 布局发布技能的第三方没有入口。OpenDesign 0.25 正是以该布局发布了十项动效技能——动效规划、160 个案例的特效库、UI 动效技法、动效评审、GSAP，以及由媒体驱动的网页动效——而本目录此前完全没有动效类技能。把它们复制进 `authored/` 会把其他仓库的文字当成本仓库的产出，并丢失下一次评审所需的上游提交；放弃它们则让目录失去唯一可得的动效技法。

## Decision

`packages/skill/skill-catalog/vendored.json` 列出目录从其他仓库发布的每一项技能：仓库、存放该技能 `SKILL.md` 的目录、设置页面归类所用的分类、署名作者，以及当技能自身描述使用其他语言时其目录行展示的英文摘要。`scripts/sync-skill-catalog.ts` 锁定每个仓库默认分支的提交，下载该技能目录，把 frontmatter 改写为安装名，并按下载技能的同样方式打包。该行的 `path` 为 `<repo>/<path>`，即设置页面显示为来源的那一行。

经评审的价值门槛只存在一处。只有当 `curation.json` 给出的价值达到 `minValue` 时，内置条目才会随目录发布：`vendored.json` 说明技能来自哪里，`curation.json` 说明它是否发布。未达门槛的条目仍记录在这两个文件中，使被否决或待定的来源对下一次评审保持可见。

包内附带其再分发所依据的许可证：技能自带 `LICENSE` 的保留该文件；仅以仓库许可证发布的技能，则把该仓库根目录的 `LICENSE` 加入包中。

## What the bar left out

OpenDesign 有两条目并不提供指令。`remotion` 与 `threejs` 描述其上游项目并让读者前往安装，因此两者都记为 `low-value` 而不发布。`remotion` 同时是主集合已占用的技能名，而一次安装不会让两个技能共用同一名称。

## Alternatives considered

**收录整个 OpenDesign 集合。** 其 169 个条目大多是该产品通往其他服务商（Figma、fal、venice）的入口或宣传占位，收录后目录会带上那些安装后对 Aeven 账户毫无作用的条目。十项经评审的动效技能才是此处真正增加能力的那部分。

**把十项技能复制进 `authored/`。** `sources.json` 是为本仓库作者编写的技能而设。复制会把其他项目的文字归到本仓库名下，并使上游的每次修正都变成手工比对。

**把第二个集合硬编码进同步脚本。** 在 `UPSTREAM` 旁加一个常量会把“技能来自哪里”写进代码，于是新增或撤销仓库都需要改脚本并重新评审脚本本身。数据文件让这项决定以数据形式接受评审。

**把第二个仓库记录进 `index.json` 与 `CatalogSkill`。** 设置页面把 `path` 作为来源行显示，`<repo>/<path>` 已可正确阅读；增加一个没有界面展示的字段，只会为 RPC 结构增加无对应行为的负担。

## Consequences

目录增长到 15 个分类、73 项技能，其中新增 `animation-motion`，包体增加约 2.4 MB。署名此后依赖每个包内的 `SOURCES.md` 与 `LICENSE`，同步只保留而不重新生成它们。为其他宿主撰写的内置技能在提及该宿主自有工具时保留其原文；两项中文技能仅配英文目录摘要，因为翻译其正文不在本次改动范围内。
