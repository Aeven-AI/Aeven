---
description: "对会话工作区的 Host Remote 读取：目录列举、文本预览以及有界的名称搜索。"
kind: "package-reference"
---

# @aeven/api-workspace-files

[English](README.md) | 中文

## 概述

`@aeven/api-workspace-files` 拥有 `workspaceFiles` Remote 命名空间，即右侧栏文件浏览器的 Host 半边。`list` 返回某目录的直接子项，`read` 返回 UTF-8 文本文件的起始一页，`search` 以广度优先遍历目录树，寻找名称包含查询串的条目。工作区根目录是 Session 头的 `cwd`，缺失时回退到沙箱策略的根目录；每一次列举、预览与搜索都不越出该根目录，这里也不做任何写入。两侧读取的是与模型文件工具相同的组合文件系统，因此一次部署对浏览器与 Agent 只需要一套访问策略。

## 目录

- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)

-----

<a id="model-experience"></a>
## 模型体验

### 工作区文件读取

#### 模型看到什么

什么也没有：该命名空间服务于侧栏的文件浏览器，不注册任何工具、提示词段落或会话事件，因此模型对工作区的读取仍归 `avn-tool-fs` 所有。

#### Token 影响

无；列举结果、预览页与搜索结果都只在浏览器中绘制，从不进入请求。

#### KV Cache 影响

无；这些调用既不组装也不改变模型请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **预览是文本文件的开头** —— `read` 最多返回 `maxLines` 行，超过 `maxBytes` 的页面会被拒绝而不是截断，含 NUL 字节或文件系统拒绝作为文本的文件会报告为非文本而不解码。
- **搜索匹配名称而非内容** —— 它以广度优先遍历目录、按大小写不敏感比较条目名，在 `searchMaxDirectories` 或 `searchMaxHits` 处停止并报告截断，且从不深入 `searchSkip` 中的名称。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为每次调用都从组合文件系统重新计算结果而不保留任何东西：工作区限定、条目与行数上限、字节拒绝都在构造该值的操作内强制执行，因此没有第二个观察可比对，也没有可在调用之间漂移的状态。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
