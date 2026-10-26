---
description: "会话书签投影：用户为会话日志中若干位置设置的标签，由 session/label 事件折叠而来，并经会话投影 seam 提供。"
kind: "package-reference"
---

# @aeven/session-labels

[English](README.md) | 中文

## 概要

一段长会话对自己内部的若干位置没有名字。回合导轨可以跳到某个回合，日志也可以搜索，但"第一次缓存未命中的那次运行"不是一个客户端能指出的位置，重新找到它意味着重读整段对话。

`@aeven/session-labels` 把 `session/label` 事件折叠成 `sessionLabels` 投影：每个已记录 `seq` 一个标签，按时间先后排列，于是客户端无需翻页整段日志就能列出会话书签并跳转到对应位置。在同一 `seq` 上再次设置标签会替换先前那个；空标签则删除它。插件只拥有这次折叠——投递、缓存与 wire 视图属于投影 seam。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时选用

在客户端列出或浏览会话历史的地方挂载它：它就是书签的读取侧。从不设置 `session/label` 的部署只承担一次空折叠，提示词与请求都没有变化。

### 最小配置

```yaml
- id: session-labels
  name: '@aeven/session-labels'
```

该行依赖 `sessionProjections`；没有该服务时 fiber 保持挂起，而不会注册到别处。

-----

<a id="understand-the-implementation"></a>
## 理解实现

### 设计概念

事件携带 `{ at, label }` 并指向更早的 `seq`，因此仅凭回放顺序就能决定结果：折叠把行按 `at` 排序，同一位置的后续标签替换先前那个，空标签删除该行。没有跨事件状态，没有 header 字段，也不需要第二种事件类型来表达删除。

日志中没有任何内容被改写，日志对模型的含义也不变：该事件不是 surface 事件，`deriveMessages` 永不会看到它，也不会由它构造任何请求。

### 源码导览

- `src/index.ts` —— 插件标识、`session/label` 事件声明与注册。
- `src/projection.ts` —— `sessionLabels` 折叠及其 wire 视图。
- `src/types.ts` —— 事件负载、折叠状态与投影键声明。

-----

<a id="model-experience"></a>
## 模型体验

### 书签事件

#### 模型看到什么

什么也看不到。`session/label` 事件只存在于日志：它不是 surface 事件，不产生消息，也没有任何提示文本由它派生。带标签与不带标签的会话发出的请求完全相同。

#### Token 影响

无。折叠在宿主上基于会话本就记录的日志事件运行。

#### KV Cache 影响

无。没有任何提示 token 变化，已缓存的前缀不受影响。

-----

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延后工作

- **尚无客户端界面。** 投影可读，但没有随附客户端渲染书签列表、导轨标记或"跳转到书签"控件；那是下一片工作。
- **标签是单一字符串，没有长度上限。** 上限属于写入它的命令，而该命令尚不存在；接受任意文本的界面在第一次写入前需要它。
- **标签属于单个会话。** 没有跨会话索引，因此"此工作区中的所有书签"不是该 seam 能回答的查询。
- **标签仅凭 `seq` 依附于目标。** 若回退（rewind）隐藏了书签指向的区间，该行仍在，客户端必须决定如何呈现一个转录已不再显示的位置。
