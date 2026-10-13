# Agent Note: 后台任务列表的每一行都可展开

Status: implemented

[English](2026-09-30-background-job-list-folds-out-every-row.md) | 中文

## 问题

会话头部的后台任务列表（[`@aeven/client-ui-jobs`](../../../../packages/client/ui-jobs/README.zh.md)）只在行内确有可读内容时才提供详情。`isObservable(job)` 的取值是 `isLive(job) || job.output.total > 0`，判定不通过的行渲染为一个静态 span：没有折叠箭头、没有事件处理、没有面板。

运行中的任务满足前半段；一旦结算，就只剩后半段。于是，从不向自身输出环形缓冲区写入任何字节的任务，恰好在结算的那一刻变得无法展开——而就在一秒之前，同一行还可以打开。有两类生产者按常规就会以空缓冲区结算。一次性后台 subagent 完全不保留输出——[`tool-subagent`](../../../../packages/subagent/tool-subagent/src/index.ts) 注册它的任务时不带任何输出源，因为那段细节归子会话所有。把输出流重定向到文件的 bash 或 pwsh 命令同样让缓冲区为空，因为每一个字节都进了文件。

这道闸门本意是避免提供一个空面板。但面板同时承载事实——开始、结束、运行时长、结果——以及启动该任务的命令，而对这类任务来说，这些就是它的全部记录：transcript 里那张 `run_in_background` 卡片在 `started background job bash-5` 之后再无内容。在报告问题的那次会话里，列表显示了七个终态任务：四个带折叠箭头，三个——命令重定向到日志文件的那三个——没有。

## 决定

每一行都可展开。`hasOutputStream(job)`——仍是 `isLive(job) || job.output.total > 0`——现在只用于闸控观察流：展开一行时，只有确有输出可读才打开它的 `job.follow` 流，而没有可读内容的任务，其输出卡片会如实说明。行的按钮、折叠箭头、详情与事实都不再依赖这个判定。

面板形态不变。运行中的行在输出卡片里显示等待文案，终态行显示无输出说明，命令卡片始终承载 `job.label`——对 shell 任务就是命令，对 subagent 就是它的描述。列表的位置、通道与终态行可见性归 [Web 后台任务展示笔记](../feature/2026-08-08-web-background-job-display.zh.md) 所有；本笔记拥有的是「哪些行可以展开」。

行的无条件化让面板的三处随之确定：

- `dotState` 的参数类型收敛为 `Exclude<JobView['status'], 'running'>`。标记的运行分支渲染加载动画，从不会向该映射索取 `'running'`，因此那条分支没有调用方。
- 停止确认对话框的主按钮以它被渲染时所针对的那个任务调用 `confirmKill(job)`，而不再去读取 `confirmJob` 状态、绕过一道没有任何渲染能够到达的判断。
- 对话框的 `className` 写成 `css.confirm as string`，即 [`DevicePane`](../../../../packages/client/ui-sidebar-device/src/client/DevicePane.tsx) 与 [`AgentPresetSection`](../../../../packages/client/ui-agent-preset/src/client/AgentPresetSection.tsx) 已用于 Modal 类名的写法：它所替换掉的 `?? ''` 回退分支无法到达，而逐文件覆盖率闸门会把它读作一条未覆盖分支。

## 考虑过的替代方案

**让不产出输出的生产者拥有输出源。** 可以让后台 subagent 任务把子会话的阶段叙述写进环形缓冲区，也可以让 shell 任务镜像它重定向到的那个文件。否决理由：子会话的 transcript 已经拥有 subagent 的细节，被重定向的文件是调用方自己的产物；而且无论哪种做法，都要给每个这类任务加一个泵，只为填充一张没人要求填满的卡片。真正缺失的是事实与命令，而这两样本来就存在，只是被闸门挡住。

**保留闸门，把终态行的事实挪进未展开的行里。** 状态词已经在行内，那么再加一行文字或更长的 tooltip 就能承载其余内容。否决理由：缺失的事实是任务何时开始、跑了多久、如何结束，它们读起来是一张列表而不是一行文字；每一行都会变高，包括大量无人展开的行；而 tooltip 也不像面板里的命令卡片那样可选中、可复制。

**每一行展开时都打开观察流。** 否决理由：对缓冲区为空的终态任务执行 `job.follow`，只会得到一条锚点、一条终态状态，然后关闭——每个展开行一次流与一次往返，只能确认空卡片已经说明的事。

**保留闸门，并让所有判定不通过的行一律不显示折叠箭头。** 这正是已交付的缺陷被写成规则。否决理由：这个可见性提示对数据的判断是错的——每一行都有详情。

## 后果

终态任务与运行中的任务一样可以展开，因此报告中的那三行现在会显示它们的事实与命令，列表也不会在提供过一次可见性提示后一秒又把它收回。输出仍然只在有人观看时流动：展开没有可读内容的行不会打开任何流。

没有任何输出的任务，其详情依然稀疏——事实、命令，以及一张空的输出卡片。没有任何机制把子 subagent 的 transcript 或被重定向的文件镜像进面板，`job.follow` 只读任务自己的环形缓冲区。

## 测试

[`packages/client/ui-jobs/tests/job-list-action.client.spec.tsx`](../../../../packages/client/ui-jobs/tests/job-list-action.client.spec.tsx) 通过渲染结果固定该行为：缓冲区为空的终态任务展开后显示事实、命令与无输出卡片，且不打开任何流（即被报告的情形）；留有输出的终态行展开并跟随其流，包括缺口标记、流失败，以及收起与关闭弹层时的释放；运行中的行等待输出；此外还有行序、两套时长词汇、终态区的折叠、清空、Escape 与外部按下关闭、两次按下确认的停止（含等待中、被拒绝，以及行先结算的路径），以及视口自适应。[`browser-plugin.client.spec.ts`](../../../../packages/client/ui-jobs/tests/browser-plugin.client.spec.ts) 在打桩的任务服务之上启动真实槽位注册表，断言头部条目出现并随其 fiber 一起移除，并驱动注入面 watch、observe、kill 与 dismiss 的调用。包内每个文件都在逐文件 100% 覆盖率闸门之内。
