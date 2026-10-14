---
description: "MemOS 记忆提供方，供启用、配置或排查长期记忆的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/memory-memos

[English](README.md) | 中文

## 概述

`avn-memory-memos` 把 MemOS 注册为 `ctx.memory` 提供方。它在 Host 进程中运行随附的 MemOS 核心（`MemoryCore`，[`@deepseek-ai/memos-local-plugin`](../../../vendor/memos-local-plugin)）：记忆存放在本地 SQLite 数据库，嵌入经 Transformers.js 在本地运行，而 MemOS 的辅助摘要与过滤调用走所属会话的 `ctx.llm` 路由，因此无需配置第二个 API key。每个账户在它自己的数据库之上有它自己的 MemOS 核心，在该账户第一次记忆操作时打开。

<a id="use-this-package"></a>
## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

## 使用本包

在 host 面挂载它，放在 `@aeven/memory` 旁边。Web bundle 以 `home: !!js avnHomePath('memory')` 与 `accounts: !!js avnHomePath('accounts')` 随附该行。

```yaml
- id: memory-memos
  name: '@aeven/memory-memos'
  config:
    home: !!js avnHomePath('memory')
    accounts: !!js avnHomePath('accounts')
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `home` | 必填 | 绝对 MemOS 运行时根目录，存放每个账户核心共用的 `config.yaml`；`MEMOS_HOME` 可覆盖它 |
| `accounts` | 必填 | 按账户子树的绝对目录；一个账户的 MemOS 数据位于 `<accounts>/<账户 id 的 sha256>/memory` |
| `hostLlm` | `true` | 当 `config.yaml` 未指定提供方时，把 MemOS 的 LLM 调用走会话的 `ctx.llm` 路由 |
| `capabilityTtlMs` | `600000` | 一条路由的推理强度能力缓存多久 |
| `language` | `auto` | 经由 Host 桥写入的已存储摘要与已学知识的语言：`auto` 从被摘要的文本检测英文或中文，也可用 `en` / `zh` |
| `classifyDomains` | `true` | 在会话路由上、于该轮次的最终回复摘要请求之内，把每个被捕获的轮次分类为 person、project 或 world 记忆并检测纠正；需要 `hostLlm` |
| `classifyTimeoutMs` | `15000` | 一次兜底分类调用的界限 |
| `candidateTraces` | `20` | Aeven 排序之前 MemOS 为召回排序的轨迹候选数 |
| `maxTextChars` | `16000` | 一条记忆存储的请求或回复文本的最长值；更长的文本保留开头与结尾，因此它约束 `memory_get` 读回的已学流程 |

领域是轨迹标签（`domain:person`、`domain:project`、`domain:world`）。会话所用的模型在写入已存储摘要的同一个请求中为每个被捕获的轮次归档：承载该轮次助手回复的摘要请求（轻量捕获把整个轮次摘要为一个步骤；完整捕获不给工具子步骤助手文本）同时收到领域规则、会话的项目，以及用户消息所回答的那条回复，因此它的 JSON 答案在 `summary` 旁给出 `domain` 与 `corrects`（[`src/domain.ts`](src/domain.ts)）。当该请求没有走 Host 桥，或它的答案没有给出领域时，改为在捕获之后运行一次简短分类调用。`remember` 直接设置领域，而未打标签的轨迹在没有工作区时捕获算作 `experience`，在工作区内算作 `project`。`world` 分类要求关于工具或环境的可复用操作或事实，而不是关于 Aeven 设计的讨论。MemOS 的 experiences 与 skills 是 `experience`，world models 是 `world`。召回为每条命中读取它的轨迹以取得领域、工作区与摘要：它丢弃在另一个工作区捕获的项目记忆，而 MemOS 检索不会过滤这一点。自动轨迹召回使用已存储的摘要，包括结果标签。显式搜索整条返回轨迹：先已存储的摘要，再是摘要所提炼自的被捕获消息，随后是已存储的工具输入、输出与助手回答。缺少摘要时保留候选片段。轨迹读取保留存储的细节，受[记忆工具的输出限制](../tool-memory/README.zh.md)约束。记忆按已登录用户区分：每个操作都运行在该作用域所属账户的核心上、走该账户自己的数据库，并仍使用 MemOS profile `user-<owner>`，因此召回、捕获与工具从不跨账户。嵌入模型每个进程只加载一次并被每个核心共享；每个打开的核心保留自己的 SQLite 连接、嵌入缓存与后台计时器。

MemOS 核心以 [`@deepseek-ai/memos-local-plugin`](../../../vendor/memos-local-plugin) 的形式随附，其[本地改动](../../../vendor/README.md#local-modifications)改变了捕获与检索。摘要器会指明每条事实是关于谁的，并且只从用户自己的话里取得关于用户或他们认识的人的事实，因此已存储的摘要绝不会把名字与其所有者分离，助手的回答也不会被存成用户事实；摘要正是 MemOS 做嵌入的对象，因此它在被写入处就固定下来，而不是事后被改写。Host 提供方把 MemOS 操作名转发给桥，最终回复的摘要请求正是借此被识别。向量扫描使用存储扫描上限，而不是由返回候选数量推导出的上限，因此数据库增长时近期事实仍可搜索。向量候选使用配置的最低相似度；重复提问不会抬高该下限。短 token 的模式通道排除常见英文虚词。

轮次开始查询先按原样运行。MemOS 会把查询中的长标识符读作硬性资格过滤，只保留逐字包含它的候选，这对标识符查找是对的，对主题查询是错的：粘贴进来的一个会话 id 或 commit hash 否则会返回空，使该轮次没有记忆。当按原样查询的那一轮没有产生可见命中，且查询含有核心能精确确认的 token——包含 `-`、`_`、`:` 或数字的小写 token，长度 16 个字符以上，因此 `long-term-memory` 这类普通复合词也符合条件——提供方在同一截止时间内去掉这些 token 重试一次（[`src/query.ts`](src/query.ts)）。显式搜索保留该标识符，因为在那种场景下它正是重点。

运行时根目录存放可选的 MemOS `config.yaml`（共用的 MemOS 核心 schema）、`data/memos.db` 与 `skills/`。缺少 `config.yaml` 时使用 MemOS 默认值：轻量流水线与本地 `Xenova/all-MiniLM-L6-v2` 嵌入模型，后者在首次使用时下载。自动召回与显式 `memory_search` 走 MemOS 的轮次开始候选路径，以绕过它两秒的相关性 LLM 过滤；MemOS 轻量模式否则会在 `retrieval.llmFilterEnabled` 为 false 时也强制开启该过滤器。显式搜索保留配置的按层结果上限，除非它的工具参数覆盖它们。Aeven 把带纠正标签的轨迹排除在自动召回之外，因为那些轮次并未指明一条可持久保留的规则或它的指称对象；显式搜索仍可把它们作为历史取回。在 `config.yaml` 中设置 `algorithm.lightweightMemory.enabled: false` 会启用策略归纳、世界模型与 skill 结晶；在 Host LLM 桥下，启动与周期性恢复随后保持关闭，因为它们运行在任何会话路由之外。

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、按账户的 MemOS 引导、注册 |
| [`src/cores.ts`](src/cores.ts) | 每个账户一个惰性打开的 MemOS 核心 |
| [`src/migrate.ts`](src/migrate.ts) | 把更早构建共用的数据库一次性拆分为按账户的数据库 |
| [`src/runtime.ts`](src/runtime.ts) | `MemoryCore` 之上的 `MemoryProvider`：命名空间、按会话的捕获队列、MemOS 会话与片段生命周期、工具引用翻译 |
| [`src/host-llm.ts`](src/host-llm.ts) | `ctx.llm` 之上的 MemOS `HostLlmBridge`，带按会话的 async-local 路由 |
| [`src/deadline.ts`](src/deadline.ts) | 前台召回的硬截止时间 |
| [`src/query.ts`](src/query.ts) | 从核心镜像过来的标识符谓词，以及用于轮次开始重试的主题查询 |
| [`src/domain.ts`](src/domain.ts) | 轮次判定与兜底领域分类，以及轨迹标签词汇，包括为一条记忆的替代者命名的标签 |

`list` 以所有者过滤跨越该所有者数据库的各个命名空间，因为核心的默认命名空间看不到私有所有者记忆，并会丢弃属于其他所有者的行。MemOS 无法按领域过滤，因此带 `domains` 的 `list` 以页大小的块读取该所有者匹配的轨迹，以确定分页并统计总数；`edit` 与 `forget` 在该所有者的命名空间中读取轨迹并在调用 MemOS 之前检查它的所有者，因为 MemOS 的更新与删除只接受一个 id。`feedback` 通过一张进程内表把被捕获的轮次映射到它的轨迹，因此它适用于自本会话上次打开以来捕获的轮次。召回（包括用于标注结果的轨迹读取）受调用方预算约束；截止时间在这里以及 MemOS 内部都强制执行，因为正在加载的 ONNX 模型可能忽略取消。捕获在按会话的串行队列中运行；关闭会话会在其已接受的捕获之后运行，而 dispose 会在关闭核心之前排空每个队列。MemOS 渲染的后续提示会点名它自己的 `memos_*` 工具；运行时把它们改写为 `MEMORY_TOOL` 的名称。

携带纠正的被捕获轮次会记录它取代了什么：要么 `@aeven/memory-context` 报告了一个纠正短语，要么轮次判定回答了 `corrects`。一次纠正回答的是它之前的那次往来，因此前一轮次的轨迹以及该轮次中 `remember` 写下的事实会在捕获时打上 `superseded:<替代轨迹>` 标签；自动召回不包含被取代的轨迹，而显式搜索把它作为历史返回。该写入在捕获队列上、于 `turn/end` 之后运行，因此不给请求路径带来任何成本。

被捕获的结果证据存放在轨迹的 `contextHints` 中，以 `outcome:` 标签建立索引，并追加到召回返回的轨迹摘要。验证被标注为助手的报告；目标完成被标注为一次已记录的目标变更。持久完成的目标还会为其轨迹带来正向隐式反馈。失败的工具调用留在轨迹中并喂给 MemOS 的工具结果路径；仅一次重试不算任务失败。显式的消息评分继续使用单独的 feedback 操作。

<a id="model-experience"></a>
## 模型体验

### 自动召回文本

#### 模型看到什么

对轮次开始召回返回的每条轨迹，到达模型的文本就是该轨迹已存储的摘要，由 `@aeven/memory-context` 框定为它召回块中的一行；摘要缺失的轨迹回退到 MemOS 注入的上下文，并把它的 `memos_*` 后续提示改写为 `MEMORY_TOOL` 名称，而与该轨迹一起存放的结果证据会追加到摘要上。带纠正标签或被更晚记忆取代的轨迹不进入自动召回，在另一个工作区捕获的项目轨迹在返回之前就被丢弃。

#### Token 影响

被召回的那一行付出它携带的摘要，受调用方约束——一行受 `@aeven/memory-context` 的 `itemMaxChars` 约束，整个块受 `contextMaxChars` 约束。本提供方放在这些行背后的内容在被写入处就有界：`maxTextChars`（`16000`）限制一条记忆保留的请求或回复文本，而自动召回在 Aeven 排序之前最多对 `candidateTraces`（`20`）个候选排序。

#### KV Cache 影响

仅追加：本提供方不贡献系统提示词段落与工具 schema，因此这些召回行在用户消息之后加入对话，更早请求的可复用前缀保持不变。

### 显式轨迹读取

#### 模型看到什么

一次有意的 `memory_search` 或 `memory_get` 整条返回轨迹，按读者需要的顺序：已存储的摘要，随后 `User message: <摘要所提炼自的被捕获消息>`，随后 `Tool record: <每个工具的名称、参数、输出与错误代码>`，随后 `Assistant answer: <被捕获的回复>`，轨迹没有的部分略去。`@aeven/tool-memory` 把该文本渲染进模型的工具结果。

#### Token 影响

在消费方设限之处有界：`@aeven/tool-memory` 按自己的 `resultMaxChars` 裁剪每条正文，而本提供方存放的细节按每条请求或回复文本受 `maxTextChars`（`16000`）约束。显式搜索保留配置的按层结果上限，除非工具参数覆盖它们。

#### KV Cache 影响

仅追加：该读取是对话中的一个工具结果，它不改变任何更早的请求。

### 辅助记忆请求

#### 模型看到什么

MemOS 自己的摘要、过滤与分类调用通过 host 桥走会话路由，并且不携带会话 id，因此它们不是对话轮次，也不触发任何会话检查点。它们的系统文本是 MemOS 的提示词加上本提供方的结尾语言规则——`Write every natural-language value in English.` 或 `Write every natural-language value in Simplified Chinese (zh-CN).`——而对被捕获轮次最终回复做摘要的那个请求会被扩展为带 `PROJECT: <会话的工作目录，或 none>`、当该轮次是在本进程中捕获时带 `PREVIOUS ASSISTANT: <用户消息所回答的那条回复>`，以及领域与纠正规则。摘要请求没有走桥、或答案没给出领域的捕获，改为接受一次分类调用，它的整个输入就是下面的框架。

##### 逐字分类输入框架

```markdown
PROJECT: <the session's working directory, or none>

USER: <the turn's user text, at most 1500 characters>

ASSISTANT: <the turn's assistant text, at most 1500 characters>

SUMMARY: <the stored summary, at most 300 characters>
```

#### Token 影响

每个被捕获轮次一次辅助请求，加上每次兜底一次分类调用，都在对话自身请求之外，并各受自己的限制约束：分类器在 `maxTokens` `40` 与 `classifyTimeoutMs`（`15000`）之内作答，而路由支持时这些调用会关闭推理。

#### KV Cache 影响

对对话无影响：每次调用都是带自己消息的独立请求，因此它既不读取也不延伸对话的可复用前缀。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- **共用数据库拆分** —— 按账户记忆启用后的首次启动会把每个账户的行从 `home/data/memos.db` 移进它自己的数据库，并把共用文件改名为 `memos.db.split`；拆分在第一个带标签的发布时移除。
- **捕获的出处** —— MemOS 把工具输出存进轨迹，因此工具读到的文本可能在后续召回中再次出现；召回的上下文被框定为不可信数据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

MemOS 的 agent 类型是 `deepseek-harness`，MemOS Viewer 服务器据此决定它的进程内宿主行为；已存储的行携带它，因此它保持固定。

**运行时不变量：** 不发布伴随模块。本提供方服务的轨迹、skill 与世界模型由该提供方自己的集成测试针对它所嵌入的 MemOS 核心断言；本包不发布自己的独立运行时关系。

</details>
