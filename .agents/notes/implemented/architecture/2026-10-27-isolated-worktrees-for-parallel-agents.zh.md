# Agent Note：并行智能体在仓库之外的隔离工作树中工作

Status: implemented

[English](2026-10-27-isolated-worktrees-for-parallel-agents.md) | 中文

## 问题

[任务获得自己的 git 工作树](2026-10-26-git-worktrees-per-task.zh.md)让会话能够创建检出，但智能体仍在互相干扰。文件、搜索与 LSP 工具针对会话头部解析相对路径，因此在 `create_worktree` 之后，智能体的编辑落在主检出中。`tool-bash` 优先使用来自头部的沙箱根，因此普通命令也在那里运行。检出位于仓库之内，处在每个会话的 `workspace-write` 根之中，因此任何智能体都能写入任何检出。隔离取决于模型是否选择调用 `create_worktree`，而子智能体从不调用。

## 决定

会话有两个被记录的事实：工作目录与工作区根。`session/cwd` 新增可选的 `root`；`@aeven/working-directory` 提供 `of()` 与 `rootOf()`，每个解析路径或写入边界的消费者都读取它们：shell、文件、搜索、LSP、`bash-edit-guard`、终端面板、`@` 文件引用、工作区文件浏览器与 `@aeven/sandbox-policy`。切换到子目录只移动目录；进入工作树则同时移动两者。

检出位于 `$AVN_HOME/worktrees/<仓库>-<摘要>/<name>`，在所有仓库之外，因此被限制在一个检出中的会话无法写入另一个检出。链接检出的提交落在仓库的共享 git 目录中，因此 `sandbox-policy` 把该目录作为 `additionalWritableRoots` 加入，Seatbelt、bwrap、Landlock、Windows ACL 授权与进程内文件系统围栏都遵循它。

每个委派的进程内子智能体都获得自己的检出。`@aeven/subagent` 在创建子级之前调用 `ctx.worktrees.isolate()`，并在其创建窗口内调用 `adopt()`，沿用与委派沙箱策略相同的可选 `ctx.get` 模式。检出从父级工作树的快照提交开始，该提交通过索引的副本构建，因此用户的索引、文件与分支都不受影响，因为被要求审阅或继续父级工作的子级必须看到其未提交的改动。没有检出的子级继承父级记录的目录。父级日志记录 `worktree/delegated`，子级日志记录 `worktree/entered`；运行时上下文告诉每个智能体它的检出，并告诉父级如何合并或应用每个子级的分支。`remove_worktree` 移除已完成的检出。

新检出运行第一个其锁文件存在的已配置准备条目，因为没有依赖的检出无法构建。服务的 git 调用禁用仓库钩子与 fsmonitor，沿用 DeepSeek Harness 的工作树服务。

## 考虑过的备选方案

- **把检出留在仓库之内。** DeepSeek Harness 这样做，并把沙箱根保持在头部。它隔离了分支，却没有隔离写入：主工作树中的智能体仍能编辑每个检出。
- **仅由模型选择隔离。** 只要任一方忘记调用该工具，两个智能体就共用同一个工作树，而这正是本 Note 要消除的失败。
- **让子级从 `HEAD` 开始。** 更简单，但审阅或扩展父级未提交工作的子级将看不到任何这些工作。
- **在沙箱内运行准备命令。** 包管理器会在检出之外写入存储，因此受限的安装会失败；准备命令作为部署选定的配置在沙箱之外运行。

## 后果

- 智能体的相对路径、普通 shell 命令与受沙箱约束的写入都跟随其检出，持久 shell 会在下一条命令时于新目录中重启。
- 在 git 仓库中启动子智能体需要一次快照、一次 `git worktree add` 与一次依赖安装。
- 父级在干净工作树上用 `git merge <branch>`，或在存在未提交改动时用 `git diff <base>..<branch> | git apply` 取回子级的工作；快照提交使该 diff 恰好是子级的工作。
- 进程外子智能体提供方、项目指令与技能发现仍读取头部目录。
- 检出隔离文件与构建，不隔离开发服务器端口或检出之外的缓存。
