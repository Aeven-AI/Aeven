---
description: "全局 send_message、interrupt_agent 与 list_agents 工具，供用户与维护者组合或排查可继续子级的控制。"
kind: "package-reference"
---

# @aeven/tool-subagent-control

[English](README.md) | 中文

## 概述

`avn-tool-subagent-control` 提供树内消息与发现、后代中断以及等待输入。同一组工具供根与其受管理子级使用。工具安装不决定委托是否启动可继续工作。

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
将本包与 subagent 服务和 Agent 注册表一起挂载。发现功能是部署可以省略的独立插件。

### 最小配置

加载 subagent 服务、一个后端、委托工具和本包。添加独立列表插件即可公开全部四个工具：

```yaml
- name: '@aeven/subagent'
- name: '@aeven/subagent-spawn-in-process'
- name: '@aeven/tool-subagent'
  config:
    provider: spawn
    backgroundMode: continuable
- name: '@aeven/tool-subagent-control'
- name: '@aeven/tool-subagent-control/list-agents'
```

本包不接收配置：根插件提供 `send_message`、`interrupt_agent` 与 `wait_agent`；列表插件提供 `list_agents`。

### send_message

通过 `agent_id` 向同一 subagent 树内的根或其他可继续成员发送消息，包括兄弟与更深后代。正在工作的目标在最近 step 接收 Steer 输入；空闲目标启动轮次。冷目标恢复时不激活其创建祖先。调用返回被接受的 `messageId`，而非回复。成员关系无效、根不可用、继续状态不受支持或准入被拒时报告失败。

### interrupt_agent

只停止目标当前轮次：已排队消息保持暂停直到之后的 `send_message`，后代继续运行，子级仍可接受后续消息。调用在停止请求被接受后立即返回，不等待目标完全停稳；中断已结束的 agent 是被接受的 no-op，而 self、sibling、陈旧与非 ancestor 调用方会收到出错结果。

### wait_agent

等待调用方下一步输入而不消费它。已有输入会立即返回；agent 消息、完成通知与用户 steering 会结束等待。`timeout_ms` 默认为 `30000`，接受 `10000` 至 `3600000` 的整数。有输入时结果为 `{ "timedOut": false }`，超时时为 `{ "timedOut": true }`。取消、Agent 释放与插件卸载会以错误结束等待，并移除监听器和计时器。等待不会启动其他 agent。

### list_agents

先列出根，再按稳定顺序列出可继续成员。`descendants`（默认）遍历整棵树并包含持久父级 id 与深度；`children` 仅显示根的直接子级。状态为 `running`、`idle` 或 `ready`。一次性子级被省略，无法读取的分支显示为 diagnostic。子级收到与根相同的树列表。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具把什么委托给 subagent 服务；可观察行为已在[使用本包](#use-this-package)中说明。

### 设计理念

`ctx.subagents.sendMessage()`、`interrupt()` 与列表投影之上的轻量适配器；工具不执行任何生命周期路由。驻留、冷恢复与授权归服务所有，工具把确切在线的调用 Agent（`exec.agent`）同时作为 sender 与权限凭据传入。

### 投递与信号所有权

工具转发其执行信号，该信号只在 inbox 接受之前掌管准入。目标一旦接受消息，该消息便无法再通过本工具取消。每条消息都以 `Agent <sender-id> sent a message:` 作为前缀，并记录 `{ kind: 'agent-message', form: 'relay', senderSessionId: sender.id }`；该来源信息由服务推导，且绝不被视为权限。

### 列表投影

`list_agents` 从调用 agent 推导根 id，不使用 cursor 读取服务目录，通过在线 Agent 注册表细化每个候选的状态，并省略无法接受 `send_message` 的一次性子级。diagnostic 在 descendants scope 中保留其位置，且绝不暴露描述符内容。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `send_message`、`interrupt_agent` 与 `wait_agent` 注册 |
| [`src/list-agents.ts`](src/list-agents.ts) | `list_agents` 注册：作用域、状态细化、投影 |
| [`src/wait-agent.ts`](src/wait-agent.ts) | `wait_agent` 输入观察与等待生命周期 |
| — | 不发布运行时不变式伴生入口；这个模型侧 adapter 没有独立 lifecycle stream；delivery 与 activation 关系由 subagent service 负责。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面；它们从工具 schema 进入其背后的继续执行服务。

- [Subagent 子系统](../../../docs/subsystems/subagent.zh.md)——可继续子级、Activation、inbox、中断与后续消息权限。
- [avn-tool-subagent](../tool-subagent/README.zh.md)——启动可继续子级的委派工具。
- [生成工具目录](../../../docs/tool-catalog.zh.md#aeventool-subagent-control)——四个工具的 schema。

-----

<a id="model-experience"></a>
## 模型体验

### 工具 schema

#### 模型看到什么

生成的 [schema](../../../docs/tool-catalog.zh.md#aeventool-subagent-control)：`send_message` 接收 `agent_id` 与 `message`；`interrupt_agent` 接收 `agent_id`；`list_agents` 接收可选的 `scope`；`wait_agent` 接收可选的 `timeout_ms`。

#### Token 影响

每个父级请求支付固定的 schema 成本。

#### KV Cache 影响

前缀保持稳定；schema 不会在运行时改变。

### 中断结果

#### 模型看到什么

接受时返回 `interrupt requested for agent <agent_id>`。未授权的调用方——self、sibling、陈旧或非 ancestor——会成为指明拒绝原因的出错结果；目标不存在或已结算仍渲染接受行。

#### Token 影响

每次调用产生一条简短确认消息；被中断轮次的中止只在子级自己的 transcript 中可见。

#### KV Cache 影响

仅追加；每个结果都位于可复用请求前缀之后。

### 投递结果

#### 模型看到什么

接受后返回 `message delivered to agent <agent_id>`；规范输出携带被接受的 `messageId`。树外目标、根不可用或准入被拒都会产生出错结果。

#### Token 影响

每次调用产生一条简短确认消息；目标的响应绝不会通过本次调用返回。child 使用同一个工具和初始任务中的 parent id，把选定内容追加到 parent 历史中。

#### KV Cache 影响

仅追加；新增可见内容位于可复用请求前缀之后，不会使现有 KV Cache 条目失效。

### 列表结果

#### 模型看到什么

首行为 `<id> [<status>] — root agent`。其他行为 `<id> [<status>] — <label>`；descendants 作用域添加 ` parent=<id> depth=<n>`。diagnostic 保留其位置。状态描述活动而非完成情况。

#### Token 影响

随所列可继续子级数量线性增长——`descendants` scope 下为整棵树；没有 cursor 或上限，因此长期存活且有许多持久化子级的父级每次调用都会承担完整列表成本。

#### KV Cache 影响

仅追加；每个结果都位于可复用请求前缀之后。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明控制工具无法观察或引导什么；它们是当前包约束。

- **已投递消息没有独立结果**——接受时只返回其 inbox `messageId`；目标后续工作会落入该目标的持久化会话，绝不会通过本工具收集。回复是另一条显式指定地址的 `send_message`，而非本次调用的结果。
- **消息限于一棵在线树**——根必须保持在线；仅冷目标会恢复，无关树与一次性目标拒绝消息。
- **列表是快照，而非投递承诺**——它可能与发布、dispose（资源释放）或后续消息发生竞态，另一个进程也可能激活当前进程报告为 `ready` 的子级；跨进程准确性需要共享租约。`interrupt_agent` 自己执行权威的在线 lineage 检查，因此过期的发现结果不会授予权限。
- **没有分页或删除**——系统返回完整且稳定排序的集合；只要子级会话仍在持久化存储中，它就会继续出现在列表中，服务级上限或删除操作留待后续产品决策。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
