# Agent Note：托管后台命令的运行时限制

Status: implemented

[English](2026-11-08-hosted-background-job-runtime-limit.md) | 中文

## 问题

在托管 Aeven Web 上，一位用户想查看一个 HTML 文件，agent 便在该账户的 jail 中以后台 bash 任务启动了 `python3 -m http.server`。没有人能访问它：每个 jail 中的命令都有自己的网络命名空间，因此该端口只存在于那条命令内部。任务却一直运行，因为后台 bash 任务没有超时，在 Host 重启之前没有任何机制会结束它。每个这样的任务都会占用其账户 cgroup 份额（2 个 CPU、2 GiB、256 个进程）的一部分，少数几个持有忙碌任务的账户就能占满 jail 整体份额（12 个 CPU、32 GiB），拖慢其他所有账户的命令。

## 决策

`avn-jobs-local` 新增 `runtimeLimitMs`，即从任务种类到毫秒数的映射。所列种类的任务运行到该时长后，注册表会终止它，详情为 `stopped at the <limit> runtime limit for <kind> jobs`；未列出的种类不受限制。托管补丁设置 `{ bash: 900000 }`，因此子 agent 与工作流任务不受影响。sandbox-jail 的 `modelNote` 告诉模型：监听的端口只能从同一条命令内部访问，不得为用户启动可访问的服务器，应如何改为展示页面，以及后台命令会在 15 分钟后停止。

## 备选方案

在托管 Host 上禁用 `run_in_background` 被否决：长时间的渲染与数据任务会因此占住整个回合，或在 `detachAfterMs` 之后照样转入后台。

在 `avn-tool-bash` 内部设限被否决：注册表本就负责任务生命周期、终止原因与结算通知，而按种类的映射放在那里可以服务将来的任何生产方。

## 影响

托管 Host 上超过 15 分钟的正当后台命令会被终止；模型会在结算通知中读到原因。`tool-bash` 的 schema 仍写着后台任务不适用超时，这对命令的 `timeoutMs` 依然成立；该限制通过托管 `modelNote` 传达给模型。
