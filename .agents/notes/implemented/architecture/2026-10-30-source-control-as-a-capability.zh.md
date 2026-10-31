# Agent Note: 源代码管理是一项能力 seam

Status: implemented

[English](2026-10-30-source-control-as-a-capability.md) | 中文

## 问题

在仓库中工作的 agent（智能体）没有办法把仓库状态当作数据来读取。需要知道暂存了什么、某项改动包含什么、或最近合入了什么的模型，要么通过 shell 运行 `git` 并解析进度文本，要么根据刚编辑过的文件猜测。提交、切换分支和合并都是没有结构的 shell 命令：一次会带走未提交工作的分支切换以退出码失败，一次冲突的合并表现为成屏输出，而不是一份待解决的路径清单。

想要同样事实的插件没有 seam 可调用。只增加一个 `git_*` 工具会把操作和面向模型的 schema 塞进同一个包，于是第二个引擎（或者一个报告 pull request 的代码托管平台）无法在不改变模型所见内容的前提下应答同样的调用。

## 决策

源代码管理是一项[能力 seam](../../../../docs/glossary.zh.md#capability-seam)，在一次变更中补齐全部三个角色：

- **定义**：`@aeven/vcs` 拥有 `ctx.vcs`，即一个以 branded provider id 为键的注册表、仓库解析，以及每个消费方都会调用的操作。注册在改动状态前先校验并做冲突检查，`ctx.effect` 在 dispose 时撤下该提供方，因此被拒绝的注册不会发布任何东西。
- **提供方**：`@aeven/vcs-git` 通过 `ctx.subprocess` 用 git 实现这些操作：按侧解析的 porcelain v2 状态、有界 diff、提交读取、分支列举与移动、fetch 与 push，以及合并分类。
- **消费方**：`@aeven/tool-vcs` 拥有 `git_status`、`git_diff`、`git_log`、`git_commit`、`git_branch`、`git_remote` 和 `git_merge` 的名称、schema、描述与渲染。

这些操作被刻意做成 seam，而不是工具形状的包装层，因为它们正是另一个引擎可以实现的那部分。一个报告 pull request、检查与评审的代码托管平台会注册自己的提供方，并暴露新的消费方工具；git 提供方与既有工具 schema 都不会移动。

改动的路径按侧分别报告，`staged` 与 `worktree` 分开，因为这正是 checkout 所持有的东西：一个文件可以先暂存改动、之后再改一次，而单一标签会丢掉一次提交将漏掉的事实。无法归类的状态字符变成 `unknown` 而不是干净的一侧，因此调用方不会把不熟悉的改动读作无需提交。

只读的 git 命令以 `core.hooksPath=/dev/null` 和 `core.fsmonitor=false` 运行，因此仓库配置的程序无法改变状态或 diff 报告的内容；会记录历史或移动 checkout 的命令运行仓库自己的钩子，因为在那些地方钩子就是用户的策略。这两个决定都遵循 worktree 服务，它已经把报告当作数据对待。

## 曾考虑的替代方案

- **用一个 `git` 工具加操作判别字段。** DeepSeek Harness 与 t3code 都以单一入口暴露结构化 git。单一 schema 让工具数量保持低，但它把九个操作塞进一个描述，并使每个结果都成为模型必须消除歧义的联合；七个具名工具则说明各自返回什么。
- **一个没有 seam 的 `git` 包。** 包更少，但每个消费方都会直接依赖 git。只做工具的设计会让面向模型的 schema 成为这些操作唯一存在的地方。
- **一个代码托管平台产品：pull request、评审、行内评论、堆叠。** t3code 针对 GitHub 构建了一个。这比需求更大的面：能报告改动、记录提交的 agent 不需要逐条线程评审 diff，而各平台的适配器日后可以在同样的操作之后注册。
- **补丁级暂存。** `git add -p` 需要 seam 未定义的一种交互式补丁应用；整条路径暂存覆盖了普通情形。

## 后果

- 模型把分支、上游、领先／落后、改动路径、diff、历史与合并冲突读作结构化值，并以操作的形式请求暂存、提交、分支、fetch、push 与合并。
- 当已跟踪文件存在未提交改动时，分支切换会拒绝执行，除非调用方设置 `allowDirty`，从而把 git 退出码变成模型可以据以行动的指令。
- 边界是部署配置：`statusMaxEntries`、`diffMaxBytes`、`logLimit` 和 `logLimitMax` 是经过校验的 `Config` 字段，每个被截断的结果都报告 `truncated`。
- 历史重写（amend、rebase、reset、revert、cherry-pick、stash）不予暴露；需要它的模型仍使用 shell。
- 含换行的路径会被状态读取器误解析：它在按 NUL 切分之后又按行切分记录。
- 进程外 subagent 提供方与这个 seam 都读取会话记录下来的目录，因此会话被移入的 checkout 会被尊重，而在启动时捕获的目录不会。
