# 智能体笔记：前台命令超时后转为后台任务

Status: implemented

[English](2026-10-19-foreground-detach-to-background-jobs.md) | 中文

## 问题

一次前台 `bash`/`pwsh` 调用占住了整个回合：模型在等，用户在等，执行器最终按自己的预算（默认 120 秒）杀掉命令。长命令是否进入后台，取决于**模型是否记得主动选择** `run_in_background: true`；因此带上了这一习惯的会话（一条记忆、一句用户指令，例如“长命令走后台，聊天才不卡”）与全新安装的表现完全不同，而全新安装两样都没有。能力早已存在，缺的是默认行为。

两个较小的事实让“改默认”比“写文档”更值得做：

- 超过 `timeoutMs` 的前台命令会被杀掉并报告 `timedOut`，模型失去了本可以继续收集的进度。
- `bash` 不纳入 `ctx.toolCallTimeout` 的统一预算，前台调用没有第二道边界；“让聊天保持响应”不能只靠提示词约定。

## 决定

**由工具决定何时停止等待，由执行器完成交接。** `tool-bash` 与 `tool-pwsh` 新增 `detachAfterMs` 配置字段（默认 20 000 毫秒，属于随部署变化的取值）。前台调用把它带进 `ctx.shell.run()` 的 `ShellExecSpec.detachAfterMs`，工具把返回的句柄注册成 `ctx.jobs` 任务，方式与显式 `run_in_background` 完全一致：一条生产者路径，两种触发。

seam 增加一种结果形状和一个同级方法——`run()` 保持“已结算结果”的约定，因此没有任何既有调用方需要改动：

- `ShellRunOutcome = ShellRunResult | ShellDetachedRun`，其中 `ShellDetachedRun` 为 `{ detached: true, process: ShellProcess, detachAfterMs }`，判别函数是 `isDetachedRun()`。
- `ShellExecSpec.detachAfterMs` 是调用方给的阈值；执行器只负责等待。
- 执行器超时的语义不变。先到者生效：阈值先到就把仍在运行的进程交还，之后不再有超时；超时或调用方取消先到则照旧杀掉命令并结算为 `ShellRunResult`，`timedOut`/`aborted` 的分类不受影响。

**deadline 可以释放。** `@aeven/timeout` 新增 `releasableDeadline()`：同样的超时与上游取消融合信号，外加 `release()`，它停止计时器并停止转发上游取消。`deadline()` 现在是它的无释放句柄版本。交接前释放 deadline 是必需的：一旦工具调用返回了任务 id，执行器超时和工具调用的 abort 都不能再杀死已经归属任务注册表的工作。为此上游转发改为手工实现，而不再使用 `AbortSignal.any` —— 融合之后无法再拆开。

**交接不丢字节。** 前台路径通过偏移读取器收集输出而从不消费，因此被接管的 `ShellProcess` 从第 0 字节读同一批收集器；命令在阈值之前写下的输出都在任务环形缓冲里。`LocalBashExecutor`/`PwshLocalExecutor` 把后台句柄的构造收进一个 `adopt()`，`start()` 与交接路径共用，`killedByUpstream` 作为参数传入：被交接的进程回答 `false`，因为调用信号已不再拥有它，之后的 abort 不得把它的退出改标为 killed。

**沙箱事实随结算，而不是随调用。** 被交接的受限进程尚未结算，因此 `SandboxBashExecutor`/`SandboxPwshExecutor` 把提供方的分类事实挂在被接管的句柄上；`onProcessDone` 在结算时写入 `process.sandbox`，与所有后台进程同源。

**随版本发布的提示词说明这一默认。** 两个工具的描述与提示词段落都以“凡是无法确定耗时的命令，一律放后台”开头，并说明将要应用的阈值。全新安装因此与带足上下文的会话行为一致，不需要记忆，也不需要用户额外叮嘱。

## 备选方案

**默认后台（`run_in_background` 默认为 true）。** 改动最小，也字面上满足“默认走后台”。它输在快路径上：`ls`、`git status` 以及所有毫秒级命令都要多一次 `job_output` 调用，模型在同一回合里拿不到输出。阈值保留了单次调用的快路径，同时不再阻塞。

**只改提示词（更强的 `run_in_background` 说明）。** 免费且可测，但它把每一次调用的行为交给模型的服从度，并且留住了 120 秒杀进程的路径。它现在是这次改动的**措辞**部分，而不是机制。

**在工具层用 `ctx.shell.start()` 竞速。** `tool-bash` 可以自己把每条命令都当作后台句柄启动，再自行与计时器竞速，从而避开 seam 变更。否决理由是超时的归属被搬进工具：`timeoutMs`、它的默认值与上限、以及首次成因的 `timedOut`/`aborted` 分类都在执行器里，工具侧终止会重复实现它们。`packages/AGENTS.md` 要求能力自己拥有终止机制。

**在超时点交接，而不是另设阈值。** 把既有的 `timeoutMs` 从“到点杀死”改成“到点交还”会取消模型对挂死命令唯一的终止手段，也改写了 `timeoutMs` 已成文的含义。第二个更早的阈值让两者并存。

## 后果

收获：在全新安装上，长命令不再占住对话；执行器超时也不再摧毁本可继续的工作。模型看到的确认形状是它已经熟悉的（`kind: 'background'` + `jobId`），扩展出 `detached`/`detachAfterMs`，让卡片与文本都能说明迁移原因；`presentResult` 通过共享的 `BACKGROUND_ACK` 前缀把这条确认当作通用卡片。

代价：seam 现在把选择写成了两个名字。`runDetachable()` 是唯一可能返回 `ShellDetachedRun` 的入口，因此想要交接的调用方必须按名称请求，而不是在 spec 上设一个字段；无法交还工作的提供方继承“继续等待”的默认实现，而不是报错。这是让 `run()` 的约定与所有既有消费者保持不变的代价。被交接的运行还会超出工具调用的生命周期，其清理归任务处置与组合拆除，和显式后台启动完全一样。

暂缓：持久会话（`tool-terminal`）的发送与 subagent 工具保留各自的后台语义，二者都不经过 `ctx.shell.run()`。仅 Windows 的组合通过 `pwsh-local` 获得同样行为，其交接测试在没有可用 `pwsh` 时自跳过，并在 Windows 矩阵上执行。
