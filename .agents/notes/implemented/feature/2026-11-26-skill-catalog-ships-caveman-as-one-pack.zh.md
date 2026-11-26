# Agent Note：技能目录把 caveman 作为一个可安装的技能包发布

Status: implemented

[English](2026-11-26-skill-catalog-ships-caveman-as-one-pack.md) | 中文

## 问题

[caveman](https://github.com/JuliusBrussee/caveman) 是 Julius Brussee 以 Apache-2.0 发布的技能集，让智能体用简短的回答保留全部技术事实。其中的 `caveman` 技能把 `/caveman ultra` 与 `/caveman wenyan` 转交给两个同级技能 `ultracave` 与 `megacave`，因此单独安装 `caveman` 会留下两条指向账户并不拥有的技能的路由。

固定版本的技能有三处事实阻碍直接内置。`ultracave` 与 `megacave` 设置了 `disable-model-invocation: true`，而 `skill` 工具拒绝仅限用户的技能，所以 `caveman` 无法加载它们。三项技能都提到 `/caveman-compress`，这是仓库中的另一项技能，通过 Python 脚本调用它自己的模型提供方（`claude` 或 `codex` CLI、Anthropic API，或兼容 OpenAI 的端点）改写记忆文件。每个技能目录还带有一份关于在 Claude Code 中安装和配置 caveman 的 README，目录的品牌改写会把它变成关于 Aeven 的错误说法。

## 决定

`vendored.json` 在 `caveman` 分类下列出 `caveman`、`ultracave` 与 `megacave`，设置 `pack: "caveman"`，署名 Julius Brussee，并通过 `files` 只发布各自的 `SKILL.md`。由于技能目录不带许可证，同步会把仓库的 Apache-2.0 `LICENSE` 加入每个包。`repositories` 映射把 `JuliusBrussee/caveman` 固定在 `e74a11cc`，并指定 `patches/juliusbrussee-caveman.patch`；`forbid` 拒绝发布的 Markdown 中出现 `Claude`、`.claude/`、`caveman-compress` 与 `disable-model-invocation`，因此重新引入其中任何一项的刷新会让同步失败。

补丁从三项技能中删去 `/caveman-compress` 的豁免条款，并从 `ultracave` 与 `megacave` 中删去 `disable-model-invocation` 一行。两者的描述仍然要求只通过各自的命令或 `caveman` 别名调用，因此模型只在明确请求时加载它们。随后包闭合检查把 `megacave` 与 `ultracave` 记为 `caveman` 行的 `requires`。`curation.json` 把三项都评为 `net-new`、价值 4，即目录的 `minValue`。

## 考虑过的替代方案

**只发布 `caveman`。** 它的两条别名路由会指向账户无法加载的技能，这正是技能包要防止的失败。

**把 `caveman-compress` 加入技能包。** 它的脚本把文件文本发送给在 Aeven 之外配置的提供方，而不是会话的模型；其余三项技能只在一条豁免条款中提到它。

**在包中保留 README。** 它们记录的是 Claude Code 的安装与钩子；经品牌改写后，会描述 Aeven 并不存在的功能。

## 影响

目录从 126 项技能增长到 16 个分类中的 129 项。技能提到的状态行钩子在此不存在；每项技能自带的回退会把模式报告为 `(not tracked by this host)`。刷新 caveman 需要更新 `ref`，针对新提交重新生成补丁，再重新运行同步。
