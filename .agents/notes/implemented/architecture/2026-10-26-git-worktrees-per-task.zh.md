# Agent Note：任务拥有自己的 git 工作树，而不是共享工作树

状态：已实现

[English](2026-10-26-git-worktrees-per-task.md) | 中文

## 问题

两个智能体在同一个仓库上工作时共享一棵工作树，也就共享一个分支、一个构建目录，以及对方留下的未提交内容。需要改代码的第二个智能体只有几条路：等待、改同一批文件，或者在第一个智能体正在准备的分支上产出提交。克隆能避开争用，但会复制对象库与整套初始化。

移植目标是 DeepSeek Harness 的 Git Worktrees 服务与 `create_worktree` 工具：它的智能体创建工作树，然后在其中工作。在 `session/cwd` 落地之前，Aeven 根本没有进入另一个目录的方式，因此这一对中的工作树部分不可能先于目录部分存在。

## 决定

`@aeven/worktrees` 拥有该操作。`create(session, { name?, from? })` 从会话生效目录解析仓库根，解析基线提交，通过 `ctx.subprocess` 运行 `git worktree add -b <branchPrefix><name> <directory>/<仓库>-<摘要>/<name> <from>`，只有在此之后才通过 `ctx.workingDirectory.enter()` 移动会话。`list()` 解析 `git worktree list --porcelain`。

顺序就是契约：目录变更是最后一步，因此检出失败会让会话留在原处，模型可以继续工作。`@aeven/tool-worktrees` 把同一操作暴露为 `create_worktree`，返回 `{ path, branch, baseCommit, repositoryRoot }`。

检出目录、分支前缀与 git 宽限期都是无默认值的 `Config`，因为部署要决定检出放在哪里、分支如何命名；基础 bundle 声明为 `$AVN_HOME/worktrees`、`avn/` 与 5000 ms。[并行智能体在仓库之外的隔离工作树中工作](2026-10-27-isolated-worktrees-for-parallel-agents.zh.md)把检出移出仓库，把写入限制在其中，并隔离了子智能体。

该容量用 shell 调 git，而不是引入库，因为检出本身就是 git 的构造：`worktree add`、`worktree list` 与 `worktree remove` 就是这些操作，包装只会重新实现它们的参数与错误文本而无所收益。

## 考虑过的替代方案

- **每个任务克隆。** 完全隔离，代价是第二个对象库、第二次安装，以及复制新任务并不需要的每一个未提交文件。
- **共享工作树、每个智能体一个分支。** 对象库共享，但工作树也共享，构建与未提交改动仍会冲突。
- **就地切换分支。** 便宜，但第一次需要干净工作树时就会丢掉另一个智能体的未提交工作。
- **诸如 `isomorphic-git` 的库。** 引入的依赖重新实现了该容量只需要三条命令，而且它的错误文本并不是用户从自己 shell 里看到的错误文本。

## 影响

- 创建工作树的任务会改变此后每次调用解析的目录，而该变更记为 `session/cwd`，因此恢复或分叉的会话会继续在该检出中工作。
- `list` 没有对应工具；`remove_worktree` 移除已完成的检出，并可选地删除其分支。
- 规格在临时仓库中运行真实 git 而不是模拟，因为值得断言的行为恰恰是模拟无法展示的：分支、目录、未被触碰的源工作树，以及 git 自身对重名的拒绝。
