---
description: "MemOS 记忆提供方，供启用、配置或排查长期记忆的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/memory-memos

[English](README.md) | 中文

## 概述

`avn-memory-memos` 把 MemOS 注册为 `ctx.memory` 提供方。它在 Host 进程中运行随附的 MemOS 核心（`MemoryCore`，[`@deepseek-ai/memos-local-plugin`](../../../vendor/memos-local-plugin)）：记忆存放在本地 SQLite 数据库，嵌入经 Transformers.js 在本地运行，而 MemOS 的辅助摘要与过滤调用走所属会话的 `ctx.llm` 路由，因此无需配置第二个 API key。每个账户在它自己的数据库之上有它自己的 MemOS 核心，在该账户第一次记忆操作时打开，或在设置了 `warmOnSignIn` 时于其登录时打开。

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
| `learning` | `true` | 在每个关闭的 episode 上运行 MemOS 的学习流水线——奖励评分、策略归纳、世界模型、skill 结晶与反馈；`false` 保留轻量的捕获与召回流水线。覆盖 `config.yaml` 中的 `algorithm.lightweightMemory.enabled` |
| `embedding` | `Xenova/multilingual-e5-small`、`query: ` / `passage: `、`cpu`、`q8`、`maxInputTokens` 512 | 本地嵌入模型、角色前缀、transformers.js 设备与精度，以及每个嵌入片段的估算 token 数，保持在 E5 的 512 token 窗口内。`embedding.similarity` 在该模型自身的尺度上设定 MemOS 的余弦阈值——召回轨迹 0.84、episode 目标 0.86、策略关联 0.94、反馈合并 0.93、世界模型聚类 0.91——按每个阈值保留的记忆对比例从 MemOS 的 MiniLM 默认值映射而来，因为 E5 对无关文本的打分接近 0.8。在 `config.yaml` 保留 `local` 提供方时覆盖该文件的 `embedding` 模型字段。模型、前缀或片段大小变更时，每个账号的已存记忆会在其核心打开时于后台重新嵌入一次 |
| `reindexBatchSize` | `100` | 重新索引时每批重新嵌入的向量数 |
| — | — | 每个账户的 `memory-recall` 设置分区（按账户，由本包注册）保存 `judge`，默认关闭：关闭时轮次开始召回不运行相关性判定，交付全部候选（包括已学流程），标记为 `unjudged`，且后续轮次不接收近期记忆，因为只有判定才能断定一个轮次是个人话题。在 47 个记录的轮次上，拿到全部候选的回答有 23 次被评为优于经判定的回答，14 次较差；判定调用让每个回答晚大约一秒开始。 |
| `relevanceTimeoutMs` | `4000` | 轮次开始相关性判定的最长时间；它获得检索剩下的召回预算，以此值为上限。失败或超时最多返回两个机械排序结果并标记降级 |
| `relevanceHedgeMs` | `2000` | 判定在这么多毫秒后仍未答复时，用相同提示词再发送一次；在此之前失败或答复不可用的请求会立即重发。第一个可用答复胜出，另一个请求被取消。`0` 只发送一次请求 |
| `procedureCandidates` | `3` | 轮次开始的召回在检索结果之外，最多向相关性判定提供的已学流程数。流程在全部记忆中数量很少且以步骤写成，按此人的用词检索很少能返回它们；召回因此把每条流程的名称和描述嵌入一次，再嵌入请求，提供超过 `procedureMinMargin` 的最接近的流程，然后是名称和描述与请求及此前对话共有词语的流程（出现在三个以上流程名称中的词不计入）。所有者的流程列表保存在内存中，直到一次记忆写入或十分钟后失效。`0` 不提供 |
| `procedureMinMargin` | `0.035` | 一条流程与请求的余弦相似度必须高出所有者全部流程相似度中位数多少才会被提供；采用相对值是因为模型的相似度集中在很窄的范围内。仅在使用本地嵌入提供方且至少有六条流程时生效；否则只由共有词语决定 |
| `relevanceMinMs` | `3500` | 即使检索用掉了召回预算的大部分，判定也至少获得的窗口，以 `relevanceTimeoutMs` 为上限；召回因此最多可在预算之后这么久才结束。`0` 只给判定检索剩下的时间 |
| `profile` | enabled、`maxChars` 6000、`batchFacts` 150、`refreshMs` 600000、`timeoutMs` 180000 | 从该所有者全部 person 记忆中不分记录早晚蒸馏出的画像；需要 `hostLlm`。 |
| `minEpisodesForInduction` | `2` | MemOS 归纳策略前须支持该模式的独立片段数（`l2Induction.minEpisodesForInduction`） |
| `candidatePolicies` | `false` | 是否同时召回 `candidate` 与 `active` 策略（`retrieval.includeCandidatePolicies`） |
| `skillsPerTurn` | `1` | 每次召回最多提供的 MemOS 技能数（`retrieval.tier1TopK`） |
| `embeddingExecution` | `host` | 本地嵌入模型的运行位置：`worker` 在提供方启动时把它加载到一个工作线程并在其中嵌入，不占用 Host 的事件循环；`host` 在首次嵌入时把它加载到 Host 进程。Web 与 Desktop 组合设为 `worker` |
| `embeddingQueuePerAccount`、`embeddingQueueTotal` | `8`、`128` | 工作线程按账户以及在整个 Host 上接受的未完成嵌入请求数；超出任一上限的请求被拒绝。Web 与 Desktop 组合让一个账户使用整个 Host 上限 |
| `coreWorkers` | `0` | 运行 MemOS 核心的工作线程数。每个账户的核心连同其数据库连接和内存向量索引位于一个工作线程上，因此搜索、排序和捕获从不占用 Host 的事件循环，不同工作线程上的账户并行运行；`0` 在 Host 进程内运行所有核心。Web 与 Desktop 组合设为 `1`，托管组合设为 `8` |
| `coreGateTimeoutMs`、`coreCallContexts` | `1000`、`4096` | 核心工作线程在跳过一次维护之前等待 Host 维护裁决的时长，以及为调用返回之后其工作发出的 LLM 请求保留会话路由的核心调用数 |
| `warmDelayMs` | `0` | 账户登录与 `warmOnSignIn` 开始加载之间的延迟，使 Host 启动时先提供其窗口。Web 与 Desktop 组合设为 `10000` |
| `warmOnSignIn` | `false` | 在账户于此 Host 登录时加载其记忆，而不是在其首个轮次期间：打开其核心，运行一次丢弃命中的检索，并列出其 person 记忆。只加载已有记忆数据库的账户，每次运行一次。Web 与 Desktop 组合启用它；服务众多账户的 Host 会把每个已登录账户的向量索引都留在内存中人物记忆列表保存在数据库旁的 `person-facts.json` 中，启动后的第一次画像读取直接使用它，同时在后台重新列出。 |

轮次开始的召回由会话路由上的一次模型调用判定，而不是 MemOS 自身的过滤器：它读取请求、先前对话以及每个候选的种类（事实、往来、日志、流程、片段、技能、知识）、领域、年龄和流程状态，决定个人或任务优先，可不保留任何候选，并报告用户是否分享个人生活。判定在 `relevanceHedgeMs` 后仍未答复时会再发送一次，第一个可用答复胜出。每次判定都会向该账户的 MemOS `api_logs` 追加一行 `recall_judgment`，记录候选数量、输入大小、检索时间、窗口、结果以及每个请求的耗时与状态，不含记忆文本。捕获判定标记为 `kind:log` 的轮次以及摘要呈现为行动记录的旧记忆会作为日志提供。已归档的流程不作为候选。`rememberMany` 逐字导入事实，跳过所有者已有的相同文本，以 `source:import` 标记导入；无原始日期时添加 `imported:undated`，其轨迹时间视为未知年龄，且不加入近期记忆候选。`turnDomain` 返回捕获轮次的领域，`setProcedureStatus` 设置已学流程的 `procedure:<status>` 标签。对工作的抱怨即使带有愤怒仍属于任务请求。判定检查每个候选的内容，包括经验片段中的个人历史，并排除无关的个人历史。捕获摘要保留广告声明、计划和评估的归属、日期及不确定性。

`profile` 提供一位密友始终会知道的内容，无论那条记忆多旧：召回只在轮次的文字与之匹配时才取到记忆。每次读取都从一份列表中取得该所有者当前的 person 记忆（略去被取代的记忆、日志与已学流程），这份列表在 person 记忆变化之前一直有效：捕获的轮次、记住的记忆或其他设备的记忆会把它标记为过时，此时读取立即使用它，同时在该所有者的轮次开始召回结束后于后台重新列出；编辑或遗忘会丢弃它，下一次读取等待新的列表。读取从这些记忆中读出每一条年度日期——紧接在 born、birthday、married 或 died 这类词之后的日期，或生日列表中的日期——已知时带年份，每个不同日期一条（[`src/dates.ts`](src/dates.ts)）。蒸馏出的画像存放在每个账户的 `data/profile.json`，并带有已并入的最新记忆游标。当存在更新的 person 记忆时，这次读取会在该所有者的轮次开始召回结束后，在提问会话的路由上启动一次后台刷新，把它们从旧到新、每次 `batchFacts` 条并入，并在每次调用后写出画像，因此被中断的刷新会从停下的地方继续（[`src/profile.ts`](src/profile.ts)）；一次失败的调用会把原因留在 `data/profile.json.error`，直到下一次成功写入。提示词保留确切的姓名与日期，写出生日期而非年龄，为每种当前状况标注日期，并略去助手自己的看法。

领域是轨迹标签（`domain:person`、`domain:project`、`domain:world`）。会话所用的模型在写入已存储摘要的同一个请求中为每个被捕获的轮次归档：承载该轮次助手回复的摘要请求（轻量捕获把整个轮次摘要为一个步骤；完整捕获不给工具子步骤助手文本）同时收到领域规则、会话的项目，以及用户消息所回答的那条回复，因此它的 JSON 答案在 `summary` 旁给出 `domain` 与 `corrects`（[`src/domain.ts`](src/domain.ts)）。当该请求没有走 Host 桥，或它的答案没有给出领域时，改为在捕获之后运行一次简短分类调用。`remember` 直接设置领域，而未打标签的轨迹在没有工作区时捕获算作 `experience`，在工作区内算作 `project`。`world` 分类要求关于工具或环境的可复用操作或事实，而不是关于 Aeven 设计的讨论。MemOS 的 experiences 与 skills 是 `experience`，world models 是 `world`。召回为每条命中读取它的轨迹以取得领域、工作区与摘要：它丢弃在另一个工作区捕获的项目记忆，而 MemOS 检索不会过滤这一点。自动轨迹召回使用已存储的摘要，包括结果标签。显式搜索整条返回轨迹：先已存储的摘要，再是摘要所提炼自的被捕获消息，随后是已存储的工具输入、输出与助手回答。缺少摘要时保留候选片段。轨迹读取保留存储的细节，受[记忆工具的输出限制](../tool-memory/README.zh.md)约束。记忆按已登录用户区分：每个操作都运行在该作用域所属账户的核心上、走该账户自己的数据库，并仍使用 MemOS profile `user-<owner>`，因此召回、捕获与工具从不跨账户。嵌入模型每个进程只加载一次并被每个核心共享；每个打开的核心保留自己的 SQLite 连接、嵌入缓存与后台计时器。

MemOS 核心以 [`@deepseek-ai/memos-local-plugin`](../../../vendor/memos-local-plugin) 的形式随附，其[本地改动](../../../vendor/README.md#local-modifications)改变了捕获与检索。摘要器会指明每条事实是关于谁的，并且只从用户自己的话里取得关于用户或他们认识的人的事实，因此已存储的摘要绝不会把名字与其所有者分离，助手的回答也不会被存成用户事实；摘要正是 MemOS 做嵌入的对象，因此它在被写入处就固定下来，而不是事后被改写。Host 提供方把 MemOS 操作名转发给桥，最终回复的摘要请求正是借此被识别。向量扫描使用存储扫描上限，而不是由返回候选数量推导出的上限，因此数据库增长时近期事实仍可搜索。向量候选使用配置的最低相似度；重复提问不会抬高该下限。短 token 的模式通道排除常见英文虚词。

轮次开始查询先按原样运行。MemOS 会把查询中的长标识符读作硬性资格过滤，只保留逐字包含它的候选，这对标识符查找是对的，对主题查询是错的：粘贴进来的一个会话 id 或 commit hash 否则会返回空，使该轮次没有记忆。当按原样查询的那一轮没有产生可见命中，且查询含有核心能精确确认的 token——包含 `-`、`_`、`:` 或数字的小写 token，长度 16 个字符以上，因此 `long-term-memory` 这类普通复合词也符合条件——提供方在同一截止时间内去掉这些 token 重试一次（[`src/query.ts`](src/query.ts)）。显式搜索保留该标识符，因为在那种场景下它正是重点。

运行时根目录存放可选的 MemOS `config.yaml`（共用的 MemOS 核心 schema）、`data/memos.db` 与 `skills/`。缺少 `config.yaml` 时使用 MemOS 默认值，但本地嵌入模型是多语言的 `Xenova/multilingual-e5-small`（`q8`，约 118 MB，首次使用时下载），并带有 E5 的 `query: ` 与 `passage: ` 前缀；每个账号的 `data/embedding-index.json` 记录为其向量建立索引的重建版本、模型、前缀与片段大小，核心在不同设置下打开时会通过 MemOS `rebuildEmbeddings` 重建全部向量，期间召回继续使用旧向量，重建完成后才记录新值；由 `learning` 字段而不是 `config.yaml` 在完整流水线与轻量流水线之间选择。自动召回与显式 `memory_search` 走 MemOS 的轮次开始候选路径。自动召回保留相关性 LLM 过滤：在会话路由上调用一次、上限两秒，剔除与本轮共享词语却并不相关的候选，调用失败或超时则回退到机械排序；显式搜索绕过该过滤，因为查询由模型自己选择。MemOS 轻量模式会在 `retrieval.llmFilterEnabled` 为 false 时也强制开启该过滤器。显式搜索保留配置的按层结果上限，除非它的工具参数覆盖它们。Aeven 把带纠正标签的轨迹排除在自动召回之外，因为那些轮次并未指明一条可持久保留的规则或它的指称对象；显式搜索仍可把它们作为历史取回。只有当下一条用户消息指出回复所陈述的某个事实是错的时，该轮次的轨迹才被取代；对工作方式的抱怨或重复的指令会让它保持可召回，因为那个轮次往往包含用户自己的指令。在开启 `learning` 并使用 Host LLM 桥时，奖励、归纳与反馈在所属会话的路由上运行，而启动与周期性恢复保持关闭，因为它们运行在任何会话路由之外。

<a id="understand-the-implementation"></a>
## 理解实现

| 文件 | 角色 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、按账户的 MemOS 引导、注册 |
| [`src/cores.ts`](src/cores.ts) | 每个账户一个惰性打开的 MemOS 核心 |
| [`src/core-pool.ts`](src/core-pool.ts) | 核心工作线程的 Host 一侧：把每个账户分配给持有账户最少的工作线程，代替其 `MemoryCore`，并处理工作线程的 LLM、嵌入和维护闸门请求 |
| [`src/core-worker.ts`](src/core-worker.ts)、[`src/core-protocol.ts`](src/core-protocol.ts) | 打开并运行分配给它的核心的工作线程入口，以及它与 Host 之间的消息 |
| [`src/migrate.ts`](src/migrate.ts) | 把更早构建共用的数据库一次性拆分为按账户的数据库 |
| [`src/runtime.ts`](src/runtime.ts) | `MemoryCore` 之上的 `MemoryProvider`：命名空间、按会话的捕获队列、MemOS 会话与片段生命周期、工具引用翻译 |
| [`src/host-llm.ts`](src/host-llm.ts) | `ctx.llm` 之上的 MemOS `HostLlmBridge`，带按会话的 async-local 路由 |
| [`src/deadline.ts`](src/deadline.ts) | 前台召回的硬截止时间 |
| [`src/query.ts`](src/query.ts) | 从核心镜像过来的标识符谓词，以及用于轮次开始重试的主题查询 |
| [`src/domain.ts`](src/domain.ts) | 轮次判定与兜底领域分类，以及轨迹标签词汇，包括为一条记忆的替代者命名的标签 |
| [`src/sync.ts`](src/sync.ts) | 通过同步的分片文档让账户的记忆表在每台设备上保持一致；两台设备上各自创建、名称相同但 id 不同的两个技能，在每台设备上都归并为 id 排序在前的那个 |

`list` 以所有者过滤跨越该所有者数据库的各个命名空间，因为核心的默认命名空间看不到私有所有者记忆，并会丢弃属于其他所有者的行。MemOS 在 SQLite 中根据已存储的领域标签与未打标签时的工作区推断，过滤 `domains` 与项目工作区可见性；没有文本搜索的分页只读取所请求的行，总数统计不加载轨迹内容；`edit` 与 `forget` 在该所有者的命名空间中读取轨迹并在调用 MemOS 之前检查它的所有者，因为 MemOS 的更新与删除只接受一个 id。`feedback` 通过一张进程内表把被捕获的轮次映射到它的轨迹，因此它适用于自本会话上次打开以来捕获的轮次。召回（包括用于标注结果的轨迹读取）受调用方预算约束；截止时间在这里以及 MemOS 内部都强制执行，因为正在加载的 ONNX 模型可能忽略取消。捕获在按会话的串行队列中运行；关闭会话会在其已接受的捕获之后运行，而 dispose 会在关闭核心之前排空每个队列。MemOS 渲染的后续提示会点名它自己的 `memos_*` 工具；运行时把它们改写为 `MEMORY_TOOL` 的名称。

轮次判定识别出具体的替代事实时，会在捕获时为前一次往来的轨迹添加 `superseded:<替代轨迹>` 标签；自动召回不包含该往来，而显式搜索将其作为历史返回。仅有纠正短语不会取代它。独立记住的事实保持有效，因为轮次级判定并未指明批量事实中的哪一条被替代；错误事实须显式编辑或忘记。该写入在 `turn/end` 之后通过捕获队列执行。

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

一次有意的 `memory_search` 整条返回轨迹，按读者需要的顺序：已存储的摘要，随后 `User message: <摘要所提炼自的被捕获消息>`，随后 `Tool record: <每个工具的名称、参数、输出与错误代码>`，随后 `Assistant answer: <被捕获的回复>`，轨迹没有的部分略去。`memory_get` 以摘要与记录日期作为轨迹标题，并以相同的标签返回 `User message:` 与 `Assistant answer:`，因此更早的回复绝不会被读成此人说过的话。`@aeven/tool-memory` 把该文本渲染进模型的工具结果。

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

- **核心工作线程持有每个已打开的账户** —— 账户的核心和向量索引在提供方停止之前一直留在其工作线程上；尚未实现关闭空闲账户。停止的工作线程会释放其账户，这些账户在下次使用时重新打开，其上进行中的调用会失败。
- **记忆同步留在 Host 进程内** —— `src/sync.ts` 通过自己的连接在 Host 线程上读写每个账户的数据库。
- **共用数据库拆分** —— 按账户记忆启用后的首次启动会把每个账户的行从 `home/data/memos.db` 移进它自己的数据库，并把共用文件改名为 `memos.db.split`；拆分在第一个带标签的发布时移除。
- **捕获的出处** —— MemOS 把工具输出存进轨迹，因此工具读到的文本可能在后续召回中再次出现；召回的上下文被框定为不可信数据。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

MemOS 的 agent 类型是 `deepseek-harness`，MemOS Viewer 服务器据此决定它的进程内宿主行为；已存储的行携带它，因此它保持固定。

**运行时不变量：** 不发布伴随模块。本提供方服务的轨迹、skill 与世界模型由该提供方自己的集成测试针对它所嵌入的 MemOS 核心断言；本包不发布自己的独立运行时关系。

</details>
