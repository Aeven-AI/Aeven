# Agent Note：技能目录把 pstack 作为一个可安装的技能包发布

Status: implemented

[English](2026-11-20-skill-catalog-ships-pstack-as-one-pack.md) | 中文

## 问题

[pstack](https://github.com/backnotprop/pstack) 是 Lauren Tan（poteto）以 MIT 许可发布的一组 Agent Skills，它是一个技能包：`poteto-mode` 路由到其余大部分技能，另有几个技能按名称加载同伴技能（`teach` 运行 `how` 与 `why`，`ketchup` 使用 `bro` 的语气）。目录过去一次只安装一个 bundle，只安装 `poteto-mode` 的读者得到的是一个每条路由都落空的路由器。

pstack 自身的两点事实让直接引入在这里无法工作。每个 pstack 技能都设置了 `disable-model-invocation: true`，而路由器按文件路径（`../<name>/SKILL.md`）读取叶子技能。账户技能库把每个技能存放在各自的修订目录中，`skill` 工具会拒绝仅限用户调用的技能，所以安装后这两条路径都走不通。该镜像还提到了本部署没有的能力：`poteto-agent` 与 `comment-sicko` 子代理类型、由 `/setup-pstack` 写入的各 harness 模型设置文件、Cursor 与 Claude Code 的模型标识、Cursor 的循环命令、`cursor-team-kit` 的 deslop 与 control 技能，以及其他 harness 的会话记录目录和技能目录。

## 决定

`vendored.json` 在 `pstack` 分类下列出 27 个 pstack 技能，并标注 `pack: "pstack"`。新的 `repositories` 映射把 `backnotprop/pstack` 固定在 `4a4f41c4`，并为它指定改写步骤：`patches/backnotprop-pstack.patch` 在目录品牌改写之前应用到固定版本的文件上，`forbid` 列表给出发布的 Markdown 文件不得再匹配的模式。补丁块无法应用或被禁止的名称仍然存在时，同步失败，因此刷新不会悄悄发布死路。同一映射把 `nexu-io/open-design` 与 `blader/humanizer` 固定在目录已发布的提交上，本次同步保持它们的行逐字节不变。

补丁做五类修改。它从其他成员会加载的 20 个技能中删除 `disable-model-invocation`，使 `skill` 工具能够加载它们；没有任何成员路由到的 7 个技能（`automate-me`、`blast-radius`、`correct`、`reflect`、`sharpen`、`statechart`、`teach`）保持上游原样，仅限用户调用。它为本部署改写 `poteto-mode` 的 Subagents 与 Harness 两节：`subagent` 工具、按角色选模型的 `list_subagent_models`、找回早先工作的 `memory_search`、`ask_user_question`、`todo_write`、用于重复检查的定时 shell 等待或经用户确认的 `automation_create`，以及技能目录 `.avn/skills/` 与 `.agents/skills/`。它把剧本和被路由技能中零散的死路替换为指向该 Harness 一节的说明。它把 `poteto-mode` 的 `watch-pr` 辅助工具从 Bun 移植到 Node：`node:util` 的 `parseArgs` 以相同的选项、默认值、冲突规则和退出状态（用法错误为 64，`--help` 为 0）取代 `commander`，启动脚本改由 `node` 运行，`omit` 去掉 Bun 引导脚本、锁文件和测试，因此该工具无需安装步骤，可在 Aeven 桌面端放入 PATH 的 Node 22.18+ 上运行。它采纳上游仍未合并的 [backnotprop/pstack#18](https://github.com/backnotprop/pstack/pull/18)，使监视工具在 GitHub 报告合并状态未知或检查待定时继续等待，而不是把新推送的提交报告为就绪。它还带上固定镜像缺少的三项上游修复：fork PR 不再加入发现的栈，评审文本中的控制字符不再到达终端（[cursor/plugins#1193](https://github.com/cursor/plugins/issues/1193)），以及在 `worker.md` 下运行并到达 `interrogate` 的委派代理会陈述假定的意图，而不是询问某个人（[cursor/plugins#1272](https://github.com/cursor/plugins/issues/1272)）。

24 条单行原则通过新的逐条目 `resources` 映射并入 `poteto-mode` 的 bundle，位于 `principles/<title>.md`，而不是发布 24 行目录条目。`omit` 把 `statechart` 3.7 MB 的测试语料排除在 bundle 之外。

同步强制技能包闭合：成员以粗体或代码形式提到的每个 pstack 技能都必须在同一技能包中发布，要么是模型可加载的成员，要么并入某个成员。成员加载的名称成为其索引行的 `requires`，Settings 在单个安装之前把它显示在行和技能页上。`installCatalogPack()` 通过与单个安装相同的逐 bundle 导入安装每个成员，遇到被拒绝的成员会继续，并返回已安装、已跳过和失败的名称；分类页为技能包显示一个开关，并列出任何失败的成员。

## 评审排除的内容

`setup-pstack` 写入本部署不读取的模型设置文件，`poteto-help` 是在 Cursor 中安装和配置 pstack 的指南；两者发布出去都是错误的指令。`recall` 挖掘其他 harness 的会话记录目录，`make-bot-ui` 驱动另一产品的 webhook 机器人，`ketchup-video` 与两个形式化验证技能不在 issue 的精选核心之内，24 条原则存放在 `poteto-mode` 内部。`agents/` 下的提示词、benny 自动化与 `.cursor-plugin/` 不纳入。

## 考虑过的替代方案

**把全部 58 个技能作为行发布。** 24 条原则是只有路由器读取的单行规则；作为行，它们会给每次目录列表以及每个安装账户的模型目录增加 24 条描述。

**让每个技能都保持仅限用户调用。** 那样路由器和依赖它的技能就无法加载它们路由到的技能，而这正是技能包要避免的失败。

**给名称加前缀（`pstack-tdd`）。** 加前缀可以避免将来与 `avn-tdd` 冲突，但要改写技能包中几乎所有交叉引用。目前目录中没有名称冲突，同步本身也会拒绝重复名称。

**在同步脚本中用正则规则代替补丁。** 这些改写是句子级的且因文件而异；补丁可以作为相对固定源码的 diff 进行评审，补丁块失败正是刷新需要评审的信号。

**把改写后的技能复制到 `authored/`。** 那样会丢失固定的来源，并把每个上游修复变成手工移植。

## 影响

目录从 99 个技能增长到 15 个分类下的 126 个技能，新增约 0.3 MB 的 bundle。已安装技能的资源以仅所有者可访问的权限写入，因此 `@aeven/host-account-integrations` 现在把以 `#!` 开头的资源写为可执行文件；`statechart` 的启动脚本和内置的 shell 辅助脚本便可像指令所说的那样按路径运行，剧本则以 `node scripts/watch-pr/watch-pr` 调用监视工具，这在 Windows 上同样可用。刷新 pstack 需要更新 `ref`、针对新提交重新生成补丁并重新运行同步，同步的闭合与禁用检查会指出刷新破坏的任何内容。
