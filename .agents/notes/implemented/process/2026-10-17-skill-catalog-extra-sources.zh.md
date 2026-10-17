# Agent Note: 技能目录也发行上游集合未收录的技能

Status: implemented

[English](2026-10-17-skill-catalog-extra-sources.md) | 中文

## 问题

随发行版附带的目录只是一份 `davila7/claude-code-templates` 的生成快照，因此一个值得随发行版提供、却既不在该集合、也不在本仓库中的技能没有进入设置页面的路径。它只能被塞进那个集合的分支，或被导入到某一个账户——单账户导入不会把技能提供给任何其他人，而把别人的文本放进集合分支，又会在一个模型可见的文件里带上版权声明。

## 决策

`packages/skill/skill-catalog/sources.json` 列出集合未收录的技能。每条都指明本仓库中存放该技能 `SKILL.md` 的目录（相对仓库根目录），并写明设置页面对它使用的分类。`scripts/sync-skill-catalog.ts` 在 `curation.json` 旁边读取该文件，把每个目录按内置技能同样的改写与 frontmatter 重命名处理后，写出 `catalog/bundles/<category>/<name>.zip`。`index.json` 把每一条记录在 `sources` 下，条目的 `path` 就是该目录；`MANIFEST.md` 为每条打印一行 `Authored source:`。

今天发行版里只有一条：`reverse-engineering`，来自 `packages/skill/skill-catalog/authored/reverse-engineering`，归入 `reverse-engineering` 分类，并在 `curation.json` 中被评为 `net-new`、价值 5。[该技能的记录](../feature/2026-10-17-authored-reverse-engineering-skill.zh.md)负责说明这份文件写了什么。

本仓库编写的技能，安装方式与目录中的上游技能完全一致：`SkillCatalog.bundle('reverse-engineering')` 读取它内置的 zip，账户导入路径像对待任何上传一样校验该压缩包。宿主、Remote 与设置页面都没有改动；也正是“安装”这一步，让它能够再从设置页面移除。

## 考虑过的替代方案

**手写索引条目与 zip。** 生成的目录是发行产物，而下一次同步会删除自己集合之外的所有包：这样加入的技能会在下个发行版消失，而在那之前仓库里会带着没有任何脚本会产出的数据。该学这项来源的是同步脚本，而不是由目录来承载数据。

**从本仓库之外的仓库固定引入该技能。** 这条路径早先的形态是按某个固定提交下载第三方技能。此后每次改动都要对一个我们并不拥有的仓库做合并，而重新分发的文本还会把一个模型会读到的文件留给了他方的版权声明。今天集合未收录的技能都不需要这样做：唯一需要的那个，已经在这里写成。将来真有一个第三方技能够格，它会连同自己的声明一起带回这种固定引入的形式。

**改为随预设提供的技能。** `@aeven/agent-presets` 已经把 `in-app-browser` 从 `presets/aeven/skills/` 送进 `aeven` 预设的每个会话。那条路是常开的而非可选的：该技能会在每个会话的目录消息里花掉自己的描述，并让每个加载它的会话都带上它的指令，包括那些从不读取二进制的会话。目录里的技能只到达安装了它的账户，而设置页面里的开关可以把它关掉。

**只靠设置页面的导入功能，谁想要谁自己导。** 那是一次一个账户，而目录的意义正是把技能提供给每个打开设置页面的账户。

**泛化为运行时可配置的任意技能来源。** 没有消费者提出这样的要求：部署只附带一份从磁盘读取的目录，而发行时的列表与上游提交、评审的工作方式一致。来源放在数据里（`sources.json`），因此新增一个技能无需改动代码。

## 后果

本仓库编写的技能没有热度信号——`downloads: 0`、空的 `author`、空的 `keywords`——因此在目录默认的热度排序里排在最后，需要靠分类或搜索到达。`reverse-engineering` 是 `reverse-engineering` 分类的唯一成员，在设置页面里单独成段。

本仓库编写的技能按构造绕过 `curation.json` 的 `minValue` 门槛：把它列出来就是评审本身。条目仍然带有评审记录，这样它的价值对读者是明示的，清单中“已评审但未内置”的计数也保持有意义。

缺少 `SKILL.md` 的目录会让同步明确失败，而不是悄悄丢掉该技能；与目录中已有技能重名则会在写出任何包之前失败。一个条目就是一个存放 `SKILL.md` 的目录；嵌套其中的技能目录不会像上游那样被单独拆出。

验证：以 `--ref 8293bc3e6130e49391c1a3530cd73212f01aec83`（目录原本固定的提交）重新生成，改动为一个索引条目、一行清单、一行分类，按本仓库的目录写出 `catalog/bundles/reverse-engineering/reverse-engineering.zip`，并移除它所替换的那个包。
