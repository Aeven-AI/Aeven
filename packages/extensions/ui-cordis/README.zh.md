---
description: "Cordis 动态插件浏览器界面说明，供选择、组合或排查工具卡片与 @pluginId 输入的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/client-ui-cordis

[English](README.md) | 中文

## 概述

`avn-client-ui-cordis` 给 web 客户端提供渲染 `cordis_define`、`cordis_run`、`cordis_stop` 与 `cordis_undefine` 调用的工具卡片，以及补全本会话已定义插件的 `@pluginId` 输入源。本包不撰写任何模型可见的内容：卡片渲染的是会话已经记录下的 call 与 result 内容。

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

在同时挂载了浏览器 runner 与 host runner 的 web 客户端中组合本包，它会加上工具卡片与 `@` 补全，不注册侧栏操作项。

### 工具卡片显示什么

`cordis_define` 卡片记录模型写下的 name、purpose 和源码，以及该定义是否在跑。`cordis_run` 卡片显示模式、插件、包与运行标识、结果，并在包注册了业务视图时经 `tool.view.cordis` 槽位提供它。`cordis_stop` 与 `cordis_undefine` 渲染紧凑的动作行。所有卡片都渲染会话记录下的 call 与 result，因此 replay 显示同一张卡。

### @pluginId 输入源

在输入框里键入 `@` 会给出当前会话已定义的插件；选中一个会输出 `@pluginId`，工具包把它变成一条钉住的引用上下文给模型。

### 需要规划的边界

定义以进程为本：刷新后的页面手上什么都没有，直到某个包再次运行。卡片和 `@` 补全读取 host 清单，并在公告后刷新。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释这些界面背后的设计；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

卡片不把运行态放进组件 state，因为 define 调用结算时卡片会在聊天流里换位置并重挂。浏览器 runner 拥有本页的 live set，本包拥有自己读取并在公告后刷新的清单。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/client/index.ts`](src/client/index.ts) | 插件入口：槽位注册、清单接线、`@pluginId` 输入源 |
| [`src/client/CordisDefineRow.tsx`](src/client/CordisDefineRow.tsx) | 只读的 `cordis_define` 卡片 |
| [`src/client/CordisRunRow.tsx`](src/client/CordisRunRow.tsx) | `cordis_run` 卡片及其业务视图席位 |
| [`src/client/CordisActionRow.tsx`](src/client/CordisActionRow.tsx) | `cordis_stop`／`cordis_undefine` 行 |
| [`src/client/card-model.ts`](src/client/card-model.ts) | 从冻结 call/result 切片派生的可回放视图模型 |
| [`src/client/inventory.ts`](src/client/inventory.ts) | 单飞清单读取及其重连处理 |
| [`src/client/status.ts`](src/client/status.ts) | 基于清单与本页 live set 的可见状态读数 |
| [`src/client/slots.ts`](src/client/slots.ts) | 注入面与包自有的 `tool.view.cordis` 槽位声明 |
| [`src/client/run-card-index.ts`](src/client/run-card-index.ts) | 每会话「最新合格 `cordis_run` 卡片」索引 |

### 清单如何保持最新

公告（`cordis/dynamic-package`、`cordis/dynamic-retract`、`cordis/request-run`、`cordis/request-run-resolved`）触发清单重读，而不是就地打补丁——因为公告不携带标签，而定义可能在两次公告之间出现或消失。读取是单飞的，因此多条公告同时结算不会放大调用次数；连接重置既丢弃在途读取、又为新读取腾出位置，所以重连绝不会发布旧 host 的行。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从这些界面逐步进入它们所操作的面，以及其调用被渲染成卡片的工具。

- [Client runner](../cordis-client-runner/README.zh.md)——卡片读取的浏览器 runner。
- [Host runner](../cordis-host-runner/README.zh.md)——卡片背后的清单与生命周期动词。
- [工具包](../tool-cordis/README.zh.md)——调用被这些卡片渲染的模型侧工具。
- [extensions 子系统](../../../docs/subsystems/extensions.zh.md)——生成的 `ctx.dynamicCordisRunner` API 与转发的 `cordis/*` 事件。
- [动态客户端渲染与附件归属 Agent Note](../../../.agents/notes/implemented/architecture/2026-08-17-dynamic-client-render-and-attachment-ownership.zh.md)——槽位注册的浏览器 UI 如何归其包所有。

-----

<a id="model-experience"></a>
## 模型体验

间接地，经由 cordis_run 与 cordis_stop 工具：它们触达本包定义卡片所驱动的同一批 host 动词，而任何模型可见效果由 runner 拥有。

#### KV Cache 影响

无；没有任何 prompt 输入源自这里。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明这些界面何时需要特别小心。它们是当前包约束，不是任务积压。

- **浏览器界面不应答运行审批**——需要审批的模型驱动运行在本包中没有操作入口。
- **call head 掉出事件窗的卡片会丢掉标签**——define 卡片的 name 与 purpose 取自调用参数，因此会话长到把它们截断时，卡片只能以自己的 call id 自称。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>

**运行时不变式：** 不发布伴生入口。插件只注册一个 keyed toolview，HMR 测试覆盖释放；per-definition run-state 只存在于浏览器进程，Host 不变式无法观察。
