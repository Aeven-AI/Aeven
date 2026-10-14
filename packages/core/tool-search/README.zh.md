---
description: "面向部署方与维护者的延迟工具发现说明，用于决定哪些工具离开模型请求、模型如何找到并加载它们，以及请求上限与提示词缓存的成本。"
kind: "package-reference"
---

# @aeven/tool-search

[English](README.md) | 中文

## 概述

`avn-tool-search` 把专用工具留在模型请求之外，直到模型主动请求它们。名称匹配所配置模式的工具（默认是每台 MCP 服务器的 `mcp__*` 工具）以名称形式列在系统提示词中的延迟工具索引里，按 namespace 分组并配上可读标题；已配置但未在服务的 MCP 服务器及其原因也一并列出。模型阅读该索引，用关键词查询列出匹配的工具，并用 `select:` 加载确切的工具。当一个 agent（智能体）携带的工具超过提供方单次请求的上限（Aeven 与 DeepSeek API 为 128 个），或工具 schema 占据了大部分提示词时，添加它。代价是：任务需要某个延迟工具时，多出一个模型步骤。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>

## 使用本包

### 配置

```yaml
- id: tool-search
  name: '@aeven/tool-search'
  config:
    defer: ['mcp__*', 'grok_imagine_*', 'mail_*']
    groups:
      - title: Image and video generation
        tools: [grok_imagine_*]
    maxResults: 8
    maxRequestTools: 128
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `defer` | `['mcp__*']` | 在加载前不进入请求的工具名称模式；`*` 匹配任意字符序列 |
| `groups` | `[]` | MCP 服务器之外的延迟工具的标题；第一个 `tools` 模式匹配名称的分组为其命名，未匹配的名称归入 `Other tools` |
| `maxResults` | `8`（1–20） | 一次关键词查询最多列出的工具数；模型提供的 `max_results` 不能超过它 |
| `maxRequestTools` | `128` | 一次模型请求最多声明的工具数；会超过它的 `select:` 被拒绝，而仅未延迟工具就超过它的提示词组装会失败 |

MCP 服务器的 namespace 标题取其 [`@aeven/mcp-client`](../../mcp/mcp-client/README.zh.md) 实例报告的 `title`，没有时取服务器名称。

### 查询形式

`tool_search` 接收一个 `query` 字符串：

- **关键词**：列出至多 `maxResults` 个匹配的工具及各自描述的第一句话，不加载任何工具。工具名称或 namespace 标题的匹配优先于描述的匹配；以 `+` 开头的关键词必须出现在名称或标题中；唯一证据只是描述中一个词的工具不会被列出。
- **`select:<name>[,<name>...]`**：从索引中加载确切的工具。非延迟工具的名称会与已加载的工具一并报告；属于未在服务的服务器的名称会报告该服务器的状态与重启查询。
- **`restart:<server>`**：连接索引中列为未在服务的 MCP 服务器，并报告它注册的工具。

### 加载到请求中或加载到 `run_code` 中

`select:` 的加载方式取决于 agent 的工具呈现方式。当 agent 的请求呈现 `run_code`（[PTC 模式](../tools/README.zh.md) `both` 或 `ptc`）时，`select:` 以所挂载代码运行时的语言返回这些工具的 SDK 声明，模型在程序中以 `tools["<name>"](args)` 调用它们；请求的工具列表从不改变。否则 `select:` 返回这些工具的 schema，并把它们加入该 agent 之后的每次请求。

-----

<a id="understand-the-implementation"></a>

## 理解实现

插件监听 `system-prompt/assemble`。对一个 agent，它从组装出的工具列表中移除延迟工具（保留已原生加载的工具），追加索引段落；没有任何延迟工具、也没有服务器宕机时，连 `tool_search` 本身也会移除。索引文本在该 agent 的首次请求时渲染，此后保持不变；之后每一步，一个 `agent/pre-step` 监听器会比较当前索引与模型上次收到的索引，两者不同时添加一条带完整替代索引、并被记录的用户消息。来源为 `compact` 的 `agent/session-start` 会丢弃固定的索引，因此压缩后的那次请求会渲染当前索引。

服务器状态来自 `@aeven/mcp-client` 响应的、按 agent 作用域分发的 `mcp/servers` waterfall（瀑布式事件）。服务器的状态不是 `connected`、且其工具名称匹配延迟模式时，它会被列为未在服务。

原生加载集合按 agent 维护。首次使用时，它从会话的原始 `tool/call` 与 `tool/result` 事件重建，读取每个成功 `tool_search` 结果中的 `Loaded tools:` 行；原始事件在压缩后依然保留，压缩只改写派生的历史。为 `run_code` 返回的声明以 `Declared for run_code:` 开头，不会加入该集合。

-----

<a id="model-experience"></a>

## 模型体验

### 系统提示词中的工具索引

#### 模型看到什么

至少有一个工具被延迟、或至少一台执行延迟的服务器未在服务时，出现 `deferred-tools` 系统提示词段落。每个 namespace 一行，列出每个延迟工具（无论是否已加载）：MCP 服务器为 `- <title>: <prefix>{<name>, ...}`，原生工具分组为 `- <title>: <name>, ...`，按标题排序。有服务器宕机时随后是一个 `Not serving now:` 块，每台一行：`- <title> (<prefix>*): <stopped|reconnecting|starting>[ after: <error>]. tool_search "restart:<server>" connects it again.`。首行取决于请求是否呈现 `run_code`。

##### 不呈现 run_code 时的首行

```markdown
Deferred tools: their schemas are not loaded, so they cannot be called yet. tool_search "select:<name>[,<name>...]" loads exact tools, callable from your next step; a keyword query lists matching tools with what they do and loads nothing.
```

##### 呈现 run_code 时的首行

```markdown
Deferred tools: call them inside run_code as tools["<name>"](args). tool_search "select:<name>[,<name>...]" returns their declarations; a keyword query lists matching tools with what they do and loads nothing.
```

#### Token 影响

该段落只花费工具名称与标题，远少于它所替代的 schema：一个延迟的 MCP 工具只花费它的名称，而不是完整 schema。每个延迟工具的 schema 都离开每次请求，直到它被原生加载。

#### KV 缓存影响

该段落按 agent 渲染一次，在压缩前逐字节保持不变，因此连接、丢失或重启服务器都不会改变系统提示词。原生加载会把 schema 加入请求的工具列表，使下一次请求从工具列表起的缓存前缀失效；为 `run_code` 加载既不改变工具列表，也不改变系统提示词。

### 索引更新消息

#### 模型看到什么

首次请求之后索引发生变化时，下一步会带上本插件的一条用户消息，内含完整的当前索引；没有任何延迟工具时内容为 `Deferred tools: none.`。

##### 消息文本

```markdown
The deferred tools changed. This index replaces the one in the system prompt and any earlier update:
<index>
```

#### Token 影响

每次变化花费一份索引的 token；索引不变时没有消息。

#### KV 缓存影响

仅追加：该消息像其他上下文消息一样加入对话，不触及之前的 token。

### tool_search 调用与结果

#### 模型看到什么

`tool_search` 的 schema 注册于 [`src/index.ts`](src/index.ts)。关键词结果每个工具一行，`- <name> (<title>): <first sentence>`，最后给出加载它们的确切 `select:` 查询。原生 `select:` 结果以 `Loaded tools: <names>` 开头，随后每个工具一行 `<function>{schema}</function>`；`run_code` 的 `select:` 结果以 `Declared for run_code: <names>` 开头，然后是 `Call them inside run_code as tools["<name>"](args).`，再是围栏中的 SDK 声明。`restart:` 结果为 `<title> is connected. Its tools: <names>.`。

#### Token 影响

关键词结果每个列出的工具花费一短行。`select:` 结果在历史中花费一次所选 schema 或声明；原生加载还会把这些 schema 加入之后的每次请求。

#### KV 缓存影响

结果是仅追加的历史。原生加载会像索引一节所述那样改变下一次请求的工具列表。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **排序基于词法**——关键词查询匹配名称、标题与描述中的词；请求的措辞若不含其中任何词，结果为空，模型只能回到索引查找。
- **声明在压缩时离开历史**——为 `run_code` 声明的工具在压缩后必须重新 `select:`，模型才能再次看到其参数；参数正确时，不带声明直接调用仍然有效。
- **`maxRequestTools` 只按数量检查**——提供方对 schema 总字节数的限制不在这里执行。
- **无不变式伴生入口**——不发布不变式伴生入口，因为延迟索引、渲染出的提示词区块与请求工具列表都由本插件自身的组装与前步路径产生，而已加载集合是从会话原始的 `tool/call` 与 `tool/result` 事件重建的，并不作为第二份权威保存。索引、加载、恢复与释放路径由本包自己的规格测试断言。

<a id="开发备注"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付行为、限制与既定理由以上文、包代码与所链接的 Agent Note 为准。

- `run_code` 加载是否成为默认，取决于对 Aeven-1.0-Flash 编写程序可靠性的发现评估；[延迟工具发现 Agent Note](../../../.agents/notes/implemented/feature/2026-10-07-deferred-tool-discovery.zh.md) 记录了这一权衡。
- 重新声明被压缩移出历史的工具，或在压缩时把常用工具提升进请求，是开放的探索方向。

</details>
