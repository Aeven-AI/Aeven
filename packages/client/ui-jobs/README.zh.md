---
description: "Web 后台任务表面：列出本会话可见任务的会话头部动作；供后台任务体验的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/client-ui-jobs

[English](README.md) | 中文

## 概述

本包渲染 Web GUI 的后台任务表面：一个会话头部动作，打开后以弹层列出本会话可见的任务。行、实时输出、人工停止与清空都经客户端任务服务（`ctx.jobs`）到达——宿主任务控制器镜像的名单流、每个打开行一条观察流，以及 kill 与 dismiss 调用——组件自身不持有任何传输状态。触发器只在会话至少有一个任务时出现，角标计数运行中与停止中的任务；终态行保持可见，直到注册表把它们丢弃。模型对同一批任务的视角属于 `avn-tool-jobs`；本包是给人类看的投影。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

与运行时一起挂载本插件；只要会话至少有一个任务，任务动作就会出现在会话头部。点击打开弹层：活跃行在前（新的开始时间在前），随后终态行（新的结束时间在前），每行显示生产者的 kind 或标题、状态，以及一个活跃时每秒跳动、完成后冻结的已耗时。

每一行都能展开，显示其事实、命令与输出。终态行与运行中的行一样可展开：没有任何输出的任务——后台 subagent，或把输出重定向到文件的命令——除此之外无处可查，剩下的只有它何时运行、如何结束，以及启动它的那条命令。展开仍有输出的行（运行中的任务，或仍保留字节的终态任务）会同时跟随其输出流；没有可读内容的任务，其输出卡片保持静默。运行中的行提供停止，终态区提供清空。

### 关闭与边界

Escape 关闭列表并把焦点交还触发器，在其外部按下指针同理。列表展示的是「一个会话通过线路视图能看到什么」，因此别的会话拥有的任务在这里永不出现；进程重启会清空列表，而文本记录里启动这些任务的 `run_in_background` 卡片仍在。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本包向 `conversation.session.header.actions` 贡献一个条目（`JobListAction`）。行来自 `ctx.jobs`，即[任务控制器](../../api/job-controller/README.zh.md)的客户端半边：每个被观察会话一条带引用计数的名单流，有输出的行在打开时一条观察流，以及停止与清空背后的 kill 与 dismiss 调用。展开一行只在确有输出可读时才启动它的观察流；收起、关闭弹层或卸载都会释放它，因此输出只在有人观看时流动。角标计数 `running` 加 `stopping`，为零时省略。行序为活跃行在前（新的开始时间在前）、终态行按新的结束时间在前，毫秒并列按更新的开始时间打破；缺少 `finishedAt` 的终态行读作其开始时间而不是负数，超过一小时的耗时停留在小时单位。终态行保持可见，因为失败任务的 `detail` 是其失败唯一可读之处；每一行都可展开，因为没有任何输出的任务别无记录。展示决策由 [Web 后台任务展示笔记](../../../.agents/notes/implemented/feature/2026-08-08-web-background-job-display.zh.md) 与[展开笔记](../../../.agents/notes/implemented/bug-fix/2026-09-30-background-job-list-folds-out-every-row.zh.md) 规定。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当任务表面不够用时阅读以下页面。它们从浏览器列表进入注册表与面向模型的工具。

- [avn-tool-jobs](../../jobs/tool-jobs/README.zh.md)——同一注册表之上的面向模型任务工具。
- [Session Controller](../../api/session-controller/README.zh.md)——折叠出本包读取的 `jobsBySession` 镜像。
- [ui-subagent](../ui-subagent/README.zh.md)——subagent 目录，运行中的一次性后台 subagent 也会出现在那里。
- [Web 客户端架构](../../../.agents/notes/implemented/architecture/2026-07-19-gui-web-client-architecture.zh.md)——浏览器插件行如何加载并注册槽位。

-----

<a id="model-experience"></a>
## 模型体验

无，因为本包为人类渲染宿主计算出的注册表状态，不触及 prompt、消息、schema、流或工具结果。

#### KV Cache 影响

无；本包从不组装或发送提供方请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制界定了当前任务列表。它们是当前包约束，不是通用任务管理对比或任务积压。

- **一行只显示任务自身流所携带的内容**——后台 subagent 自身不保留输出（那段细节由子会话所有），把全部输出重定向到文件的命令则让环形缓冲区为空。这类行展开后是事实与命令加上一张空的输出卡片；没有任何机制把子会话记录或被重定向的文件镜像进来。
- **列表不等于注册表自己的集合**——它展示的是一个会话通过线路视图能看到什么，因此别的会话拥有的任务在这里永不出现；进程重启会清空列表，而文本记录里启动这些任务的 `run_in_background` 卡片仍在。无主任务（没有活体 `Agent` 时启动的）反过来会进入每个会话的列表，与 `list(caller)` 对每个调用方的报告一致。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。本包只把客户端任务服务的名单与观察状态只读投影到一个 header slot，不发出 Cordis 事件，也不持有跨插件可变状态。
