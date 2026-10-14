# Agent Note: 使用 MemOS 提供方的长期记忆

Status: implemented

[English](2026-09-28-long-term-memory-memos.md) | 中文

## 问题

agent 每个会话开始时都不带任何对早前工作的记忆：用户偏好、在某个仓库或应用中奏效的做法，以及哪些路径已经失败。MemOS（`@memtensor/memos-local-plugin`）提供一个本地记忆引擎，具备分层轨迹、策略、世界模型与 skill 结晶，并为 DeepSeek Harness 附带了适配器。Aeven 是 DeepSeek Harness 的硬分叉，包已重新限定为 `@aeven/*`，因此该适配器对 `@deepseek-ai/dsh-*` 的对等依赖在这里无法加载，若照原样采纳，记忆架构就会变成 MemOS 的插件。

## 决策

Aeven 在 `packages/memory/` 中拥有一个完整的能力 seam，MemOS 作为其中一个提供方位于其后：

- `@aeven/memory` 以提供方无关的方式定义 `ctx.memory`（作用域、召回、轮次采集、条目读取）以及 `MEMORY_TOOL` 名称。
- `@aeven/memory-memos` 移植 MemOS DeepSeek Harness 适配器的 MemOS 一侧：固定版本 `MemoryCore`（2.0.20）的引导、按会话串行的采集队列与 MemOS 的会话／episode 生命周期、经由 `ctx.llm` 的宿主 LLM 桥、硬性召回截止时间，以及回环 Viewer。
- `@aeven/memory-context` 移植该适配器的宿主一侧：在第一个 `agent/pre-step` 上为每个被接受的直接用户轮次执行一次召回，并在 `turn/end` 上把已提交的会话事件装配成轮次交给提供方。
- [结果采集](2026-09-28-memory-outcome-capture.zh.md)在这些轮次旁记录重试、纠正、已报告的自验证与 goal 完成。
- `@aeven/tool-memory` 在 Aeven 的名称下移植这六个读取工具。

DeepSeek Harness 适配器在编码了经过测试的决策之处保留其行为：召回读取下游的 pre-step 决策；只有来源为 `user` 的消息才触发召回或采集；在呈现层替换一个工具结果不算第二次执行；召回有独立于提供方取消的硬性截止时间；辅助 LLM 调用在该路由支持时请求 reasoning 为 `off`，且不携带会话 id；当 Host 桥是唯一 LLM 路由时，自动恢复保持关闭。

### 模型可见文本

被召回的上下文以插件来源的持久 `user/message`（`form: 'recall'`）进入，因此会被记录并逐字回放；Consumer 拥有 `<memory_context>` 框架并转义其结束标签。MemOS 渲染的后续提示会写出它自己的 `memos_*` 工具名与 `kind="world_model"`；提供方把它们改写为 `MEMORY_TOOL` 名称和 `world-model`，因为提供方拥有它返回的文本。

### 按用户的记忆

记忆属于一个已登录账号。连接宿主在 `ctx.identityUsers.runAsCaller` 内运行每个获准的 `/api` 请求，会话创建时把 `actingUser().id` 记录为 `SessionHeader.owner`；fork 与 subagent 会话继承它，JSONL 持久化存储它。`MemoryScope.owner` 为必填，`memoryScopeOf` 对没有 owner 的会话返回 undefined，MemOS 提供方把每个 owner 映射到自己的 profile（`user:<owner>`），因此召回、采集与读取永不跨账号。没有 owner 的会话没有记忆，而不是共享一个池，这也让日后的云同步可以按用户进行。

### 记忆领域

每条记忆是 `person`、`project`、`world` 或 `experience`。MemOS 会给采集到的记忆盖上 workspace 键，但既不对它分类，也不按 workspace 过滤召回，因此这两件事都由提供方负责：每次采集后，它向该会话的模型询问本轮的领域并记录为 `domain:` 轨迹标签；召回时它读取每个轨迹命中的标签、workspace 与摘要，并丢弃其他 workspace 的 project 记忆。`memory-context` 自行渲染召回的命中并按领域分组，从而取代 MemOS 自己渲染的上下文及其把记忆当作既定知识的指令。

### 记忆操作

`ctx.memory` 还会列出、记住、编辑、遗忘该 owner 的记忆并记录反馈。`edit` 与 `forget` 在调用 MemOS 之前检查轨迹的 owner，因为 MemOS 的 update 与 delete 只接受一个 id；`list` 跨命名空间按 owner 过滤。`message-feedback` 在持久写入后发出 `message-feedback/changed`，`memory-context` 把它所采集轮次上的评分转成 `ctx.memory.feedback`；按 agent 划分的实例只处理自己运行过的会话，因此一次评分只记录一次。对于用户明确要求记住的事实，模型可以使用 `memory_remember`。

### 组合

Web 组合包在宿主平面上挂载 `memory` slot，并把 `memory-memos` 提供方挂载为禁用状态。`standard`、`cordis` 与 `ptc` preset 挂载 `memory-context` 与 `tool-memory`。只有当每一行注入的服务都存在时 preset 才会挂载，因此该 slot 始终存在，Consumer 则把自身的提示词分段与工具都门控在 `ctx.memory.whileActive` 之上：启用提供方那一行即可打开该功能，没有提供方时不会出现任何记忆工具或指引。

## 考虑过的替代方案

**照原样采纳 DeepSeek Harness 适配器。** 已否决：包已重新限定为 `@aeven/*` 的硬分叉无法加载它对 `@deepseek-ai/dsh-*` 的对等依赖，而未加改动地采纳它，会使 MemOS 的插件成为记忆架构，而不是 Aeven 自有 seam 之后的一个提供方。

**让 MemOS 渲染召回的上下文。** 已否决：`memory-context` 自行渲染召回的命中并按领域分组，从而取代 MemOS 自己渲染的上下文及其把记忆当作既定知识的指令。

**为没有 owner 的会话提供共享记忆池。** 已否决：没有 owner 的会话没有记忆，而不是共享一个池，这也让日后的云同步可以按用户进行。

**只保留该适配器的提供方一侧。** 已否决：本说明保留的经过测试的决策正在该适配器的宿主一侧——召回读取下游的 pre-step 决策、只有来源为 `user` 的消息才触发召回或采集、独立于提供方取消的硬性召回截止时间，以及请求 reasoning 为 `off` 且不携带会话 id 的辅助调用。

## 后果

- 记忆存储在 `$AVN_HOME/memory` 下，在 Aeven 拥有自己的记忆 UI 之前通过 MemOS Viewer 查看。
- MemOS 引入原生 `better-sqlite3`、`onnxruntime-node` 与 `sharp` 构建（已在 `pnpm-workspace.yaml` 中允许）；桌面打包目前尚未随附它们。
- MemOS 轨迹会存储工具输出，因此工具读取过的文本可能在后续召回中再次出现。召回上下文被标注为不可信数据；按来源的采集规则被推迟。
- 按用户隔离之前采集的记忆位于无 owner 的 preset profile 中，没有任何账号会读取它。
- 会话查询的 SQLite 索引尚未存储 `owner`；今天读取它的任何东西都不需要 owner。
- 传给 MemOS 的 agent 类型是 `deepseek-harness`，因为内嵌的 Viewer 服务器按该值决定其进程内宿主行为。
