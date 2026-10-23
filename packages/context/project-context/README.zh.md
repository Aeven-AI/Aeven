---
description: "为运行在用户项目文件夹中的会话提供项目定位：一条持久消息指明该文件夹、由 README 提取的摘要、其顶层内容，以及用户的其他项目文件夹。"
kind: "package-reference"
---

# @aeven/project-context

[English](README.md) | 中文

## 概述

归档在项目文件夹中的会话一开始就知道自己在哪个项目里：在首个尚未带有该消息的步骤之前，模型会收到一条持久消息，指明工作目录就是用户自己的项目，引用其 README 的开篇正文，列出其顶层内容，并指明用户的其他项目文件夹，因此关于该项目的问题会从其文件中作答，而不是依赖通用知识。该消息带有来源、被记入日志，并且每个会话只注入一次；后续步骤、恢复的会话以及重发的请求都复用同一条。它通过已挂载的 `ctx.fs` 提供方读取；文件夹不存在、不是目录，或会话没有工作目录时，它保持静默。

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

在会话被归档到项目文件夹、且文件系统提供方能够读取这些文件夹的任何组合中挂载它。常见路径无需任何配置：`aeven` 智能体预设按默认值挂载本插件。

### 何时选择它

当产品把会话归档到用户自己的某个文件夹——代码检出、文档目录、项目目录——并且模型应当从该文件夹作答、而不是依据它对同名文件夹的记忆作答时，选择它。会话没有工作目录的产品（例如私人聊天）从中什么也得不到；宁愿逐个显式说明项目的组合则不挂载它。

### 最小配置

```yaml
- name: '@aeven/project-context'
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `readmeNames` | `['README.md', 'README']` | 工作目录中的候选 README 名称；读取第一个存在的文件 |
| `maxReadmeBytes` | `65536` | 提取摘要前从该 README 读取的字节数 |
| `maxSummaryLength` | `1200` | 摘要中保留的 README 正文字符数（码点）；更长的正文以 `…` 结尾 |
| `maxEntries` | `60` | 列出的顶层条目数上限，其余计为省略 |
| `ignoredEntries` | `['node_modules', 'lib', 'dist', 'build', 'coverage']` | 除点开头的条目外，列表中略去的顶层条目名 |
| `maxRelatedProjects` | `20` | 指名其他项目文件夹数上限，其余计为省略 |

每个字段都在插件加载时校验；无效值会使挂载失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释定位消息如何组合、何时被跳过；可观察行为见[使用本包](#use-this-package)。

### 设计理念

插件前置注册一个 `agent/pre-step` 监听器，先委托下游，然后把一条 `UserMessage` 追加到进入步骤的消息中。由于该消息是一条带显式来源的普通会话事件，模型可见的定位与日志记录是同一个对象：重放、恢复以及重新派生请求读到的都是模型当时读到的文本。

两个检查决定是否追加。自身决策已带有本插件消息的步骤不再追加，可见表层已带有该消息的会话也不会追加第二条。表层扫描读取持久事件而非进程状态，因此恢复的会话以及定位消息已被压缩遮蔽的会话都恰好保留一个注入点。

组合只读取已挂载提供方暴露的内容。`ctx.fs` 负责解析并 stat 工作目录、读取第一个 README 候选并列出顶层；缺少提供方、缺少工作目录，或工作目录 stat 结果不是目录时，都不会产生消息。`ctx.get('workspaceRegistry')` 是可选的：挂载时，消息还会指明该会话所有者其他的文件夹工作区，过滤条件是 `kind: 'folder'`、路径已定义、路径不是当前工作目录，且所有者就是本会话的所有者，因此其他账户的文件夹绝不会进入本会话。

渲染出的文本包裹在 `<project_context>` 标签中，仓库可控文本里出现的 `</project_context` 会被转义，因此 README 无法关闭插件自有的框架。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、pre-step 监听器、README 摘要提取、定位文本渲染 |
| — | 不发布运行时不变式伴生包（No runtime invariant companion is published），因为本插件不持有第二个可与之发散的观测：定位只根据文件系统与注册表组合一次，而插件自身的表层扫描是它所写消息的唯一读者。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定不够用时阅读以下页面。它们从挂载本插件的组合进入相邻的请求上下文包与穷尽式配置。

- [智能体预设](../../preset/agent-presets/README.zh.md)——默认挂载本插件的组合。
- [context 组地图](../README.zh.md)——相邻的请求上下文包。
- [智能体指令](../agent-instructions/README.zh.md)——说明如何在该文件夹中工作、而不是该文件夹是什么的包。
- [Workspace Registry](../../workspace/workspace/README.zh.md)——提供用户其他项目文件夹的可选注册表。

-----

<a id="model-experience"></a>
## 模型体验

### 项目定位

#### 模型看到什么

一条来自 `project-context` 插件的 user 角色消息，在首个尚未带有它的步骤之前注入。`<cwd>` 是会话工作目录；README 摘要去掉了 front matter、围栏代码、标题、图片、HTML、表格与短链接行后拼接而成，并截到 `maxSummaryLength` 个码点；列表中的目录以 `/` 结尾；每个可选段落只在有内容时出现。

##### 定位消息

```markdown
<project_context>
This conversation runs in the person's own project folder, <cwd>. When they ask about this project — what it is, how it works, or how it is built, deployed, hosted, scaled, run or paid for — read its README, docs and the code involved before you answer, and follow references from those files into related folders. Answer from what the files say, and search the web only for facts outside the project, such as a provider's prices or limits. If the files do not settle a question, say what you could not find instead of guessing from the project's name.

README summary: <README opening prose>

Top level: <entry>, <entry>/ and <count> more

The person's other project folders, which may hold other parts of the same product, such as its server, website or components; read them the same way when a question reaches into them:
- <title>: <path>
- and <count> more
</project_context>
```

#### Token 影响

每个会话一条消息，最多 `maxSummaryLength` 个码点的 README 正文，加上列表与其他文件夹行。它留在对话记录中，并随该会话此后每个请求一起重发，直到压缩将其遮蔽；已带有它的步骤不会新增内容。

#### KV Cache 影响

仅追加。消息被追加到进入步骤的消息中，因此它扩展请求而不是替换早期 token，后续步骤也不会改变它。恢复时表层仍带有该消息的会话复用同一个前缀。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明定位何时不完整或不会出现。它们是当前包约束，不是任务清单。

- **摘要仅来自 README 正文**：插件跳过标题、围栏代码、表格、图片、HTML 以及语言切换器等纯链接行，因此 README 以标题和徽章列表开头的项目只会得到更短甚至没有摘要。
- **列表只有一层**：子目录只被指名，不被描述；嵌套的包、服务器或网站需要读取才能发现，而不能从消息中得到。
- **不发布不变式伴生包**：本插件不持有第二个可与之发散的观测——定位只根据文件系统与注册表组合一次，而它自身的表层扫描是它所写消息的唯一读者。
- **没有工作目录的会话什么都得不到**：私人聊天以及工作目录 stat 结果不是目录的会话都收不到定位消息。
- **相关文件夹需要 `ctx.workspaceRegistry`**：没有该提供方的组合只指名工作目录，归属于其他账户的文件夹绝不会被列出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本插件由 `aeven` 智能体预设与 `agent-instructions`、`time-context` 一起挂载；该预设的注释记录了为何定位与指令分开。摘要提取是对 Markdown 块的启发式处理而不是解析器，因此“摘要应当包含什么”的改动应落在 `readmeSummary` 中，并会改变每个挂载它的组合所见的内容。

</details>
