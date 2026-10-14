---
description: "面向用户与维护者的 Aeven 云端推理适配器说明：配置 aeven-cloud 路由、模型目录与推理默认值。"
kind: "package-reference"
---

# @aeven/llm-aeven

[English](README.md) | 中文

## 概述

`@aeven/llm-aeven` 在 harness LLM 服务上注册 `aeven-cloud` 提供方路由，指向 Aeven 网关。它复用 `@aeven/llm-deepseek` 的 `DeepSeekAdapter` 作为传输层，因为该适配器只负责传输——“对 OpenAI 兼容的 chat-completions 端点做 fetch 加 SSE”——而网关说的正是这套协议；再写一个适配器只会是同一套协议行为带上自己那份同样的缺陷。两条路由的差别不在传输，而在其背后的权威：DeepSeek 平台与 Aeven 平台。

由此带来的实际结果是：存在一条已登录用户无需出示 API 密钥即可使用的路由。密钥是用户直连提供方时必须自备的东西；而 Aeven 登录已经确立了同一件事，因此 base URL 不是一项需要同步的新设置，而是客户端本就已通过认证的来源，凭据则是宿主本就已校验的会话。这就是本路由与 `deepseek-official` 之间的全部差别。

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

当组合需要向已登录的读者提供 Aeven 自有模型时，挂载本插件。它注册一条路由、公布一份目录，并按请求解析端点与凭据，因此挂载之后才出现的会话在下一次调用即可使用，无需重启。

### 何时选择它

当推理与身份应当同源时选择本条路由。当部署自持 DeepSeek API 密钥并直连 DeepSeek 平台时选择 `avn-llm-deepseek`。两者可以并排挂载：路由名不冲突，而且一位读者同时拥有已登录会话与个人密钥是完全合理的。

目录通过 `registerModelDiscovery` 公布，因此模型选择器会像呈现其他提供方条目一样呈现这些条目，已登录读者无需触碰密钥字段即可与模型对话。

### 最小配置

```yaml
- name: '@aeven/llm-aeven'
  config:
    apiUrl: http://localhost:9000   # Aeven API origin; /v1 is appended
    apiKeyEnv: AEVEN_TOKEN          # credential holding the signed-in session
    reasoningEffort: high           # off | low | high | max
    maxTokens: 384000               # optional per-request output cap
```

只有 `apiUrl` 与 `apiKeyEnv` 描述请求发往何处、由什么认证。其余各项都有与网关一致的随包默认值。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `apiUrl` | `http://localhost:9000` | Aeven API 来源；会追加 `/v1`，因此来源仍是运维方唯一需要配置的事实 |
| `apiKeyEnv` | `AEVEN_TOKEN` | 持有已登录会话的凭据引用，先经凭据 seam 解析，再回退到环境变量 |
| `models` | Aeven Flash + Aeven Pro | 供发现类消费者读取的建议性目录；设置中的一节会整体替换它 |
| `thinking` | `enabled` | 部署策略；`disabled` 会把每个请求锁定为 `off` |
| `reasoningEffort` | `high` | 默认强度：`off`、`low`、`high` 或 `max` |
| `maxTokens` | `384,000` | 单请求输出上限；模型自身上限与请求显式取值优先 |
| `defaultContextWindow` | `1,000,000` | 模型没有精确值时的容量回退 |
| `streamIdleTimeoutMs` | `300,000` | 单次未结束流读取允许的最大提供方空闲时间 |
| `maxInlineRequestImageBytes` | 6 MiB | Base64 预览预算；为文本和工具 schema 保留网关请求上限中的 2 MiB |
| `inlineImageOffloadByteQuantum` | 3 MiB | 每次超出字节预算时移除最旧的预览；持久图片和本地引用路径仍然可用 |
| `maxImagesPerRequest` | 30 | 图片数量上限；网关转发 DeepSeek 模型所经的 DeepInfra 拒绝更多图片 |
| `imageOffloadCountQuantum` | 10 | 每次超出数量上限时移除的最旧图片数 |
| Files API 设置 | 适配器默认值 | 本路由没有 Files API |
| `retryPolicy` | 常规，5 次重试 | 提供方自有的重试策略，在注册时解析一次 |

生成的[配置目录](../../../docs/config-catalog.zh.md#aevenllm-aeven)是每个可接受字段及其 JSDoc 的完整来源。

### 随包目录

随包提供两个条目，因为选择器在发出任何请求之前就需要标签与上限：`Aeven-1.0-Flash`（名为 “Aeven Flash”，可读取图片）与 `Aeven-1.0-Pro`（名为 “Aeven Pro”，不可）。两者都公布 1,000,000 token 上下文窗口与最多 384,000 输出 token。

目录是随包提供而非实时拉取的，这是有意为之。实时列表是按权益范围裁剪的——它回答的是某个*账号*可用什么——而这对每个账号都会读取的目录来说是错误的输入。随包提供还意味着该列表绝不会*收窄*所提供的内容：免费账号仍然看得到付费模型，并从拒绝中得知需要升级方案，而不是让该模型无声消失。Models 页面的“获取可用模型”动作也正是出于这个原因由这些条目作答。

### 以登录代替持有密钥

`resolveApiKey` 先经凭据 seam 读取凭据引用，再回退到启动环境，因此无头运行可以在没有凭据存储的情况下提供 `AEVEN_TOKEN`。当两者都没有值时，请求以 `MISSING_CREDENTIAL` 失败并指出补救方式——登录，或在无头运行时存入该 token。该消息刻意不提“去找一个 API 密钥”，因为缺少密钥并非故障原因，提它只会把读者引向无法解决问题的地方。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内部细节——点击展开</summary>

本节解释适配器背后的设计；可观察行为已在[使用本包](#use-this-package)中完整覆盖。

### 设计理念

一个类与一次解析步骤承载了整个适配器。`AevenAdapter` 继承 `DeepSeekAdapter` 并且只覆盖一处——`providerInfo`——因为继承来的实现会用 DeepSeek 自己的品牌回答它所拥有的每一条路由，而选择器所显示的身份正是唯一无法继承的事实。其余部分就是原样的传输层。

`options()` 是从原始配置到经过校验的连接事实的唯一路径，并且它把每个默认值都从 schema 重新声明一遍，而不是留给 schema 填充：schema 会为经 loader 解析的条目填充它们，但类型保持可选，以便设置中的一节可以只提供子集。把端点与凭据解析进同一个值，正是让请求不可能把过期来源与更新后的会话配在一起的原因。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、按请求解析、凭据解析、目录与路由注册 |

### 注册

`apply` 完成四项注册：可配置提供方条目（`aeven-cloud`，显示名 `Aeven`，设置命名空间 `llm-aeven`）、模型发现应答、适配器本身，以及为每个请求提供稳定归因的匿名用户 id 解析器。`prepareExtensions` 是返回空字段与接受回调的空实现，因为该网关不承载插件贡献的顶层字段。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级契约不够用时，请阅读以下页面。

- [avn-llm 服务](../llm/README.zh.md) —— 本适配器所注册的提供方中立服务。
- [llm-deepseek 适配器](../llm-deepseek/README.zh.md) —— 本路由复用的传输层，以及本路由未配置的 files API 行为。
- [llm-retry](../llm-retry/README.zh.md) —— 执行本适配器 `retryPolicy` 的重试执行器。
- [LLM 流式子系统](../../../docs/subsystems/llm-streaming.zh.md) —— `StreamChunk` 协议与适配器契约。
- [配置目录](../../../docs/config-catalog.zh.md) —— 每个可接受字段，由源码 JSDoc 生成。

-----

<a id="model-experience"></a>
## 模型体验

### Aeven 请求

#### 模型看到什么

被选中的 Aeven 模型会收到 harness 系统提示、消息历史、工具 schema、停止序列与调用配置（`maxTokens`、`reasoningEffort`、`temperature`），不含适配器撰写的提示文本。由于本路由未配置 files API，图片以 `image_url` 片段内联携带，而不是作为已上传的文件引用，并且没有任何请求贡献插件自有的顶层字段。

#### Token 影响

提供方的分词决定精确的文本与图片 token 输入。内联图片由网关按其对任何 OpenAI 兼容视觉请求所采用的同一套记账方式计为图片 token；适配器自身不增加 token。`totalTokens` 是 `prompt_tokens + completion_tokens` 的精确合计。

#### KV Cache 影响

未改动的已装配前缀有资格复用网关缓存，适配器会在 usage 中报告。模型路由、提示、schema、历史或图片的任何变化都可能使复用自首个受影响 token 起失效，而推理回传在每个带推理的轮次都会追加内容。

### Aeven 响应

#### 模型看到什么

推理、文本与原始字符串工具参数会被翻译为 harness 分片，供循环记录与装配。

#### Token 影响

生成的 token 遵循请求所记录的推理强度与 `maxTokens`；只有被循环保留的块会影响后续输入。

#### KV Cache 影响

被循环保留的响应块会追加到下一个请求并保留其先前可复用的前缀；被丢弃的块对后续缓存没有影响。更换提供方或模型会选定不同的缓存域。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制界定适配器止步之处与未来工作的起点。它们是当前的包约束，不是与 Aeven 网关的一般性对比，也不是任务清单。

- **没有 files API，因此没有上传行为** —— 图片以内联 `image_url` 片段传输。传输层实现的 Files API 路径（上传缓存、过期、刷新、失效 id 恢复、配额清理）在本路由上不可达；若网关将来提供 files API，本路由需要开始使用它们。
- **请求预算包括文本和 schema**——默认内联图片预算为其他 JSON 内容保留 2 MiB。采用不同网关上限或更大文本请求的部署必须配置相应的图片预算。
- **目录是随包提供而非实时拉取** —— 这是有意为之，因为实时列表按权益范围裁剪。网关新增的模型在随包发布之前不会被提供。
- **不含插件贡献的顶层请求字段** —— `prepareExtensions` 不贡献任何内容，因此 DeepSeek 路由所携带的会话日志与插件清单扩展在此不存在。
- **`thinking` 与 `reasoningEffort` 只转发、不强制** —— 网关接受这两个值；它如何处理属于其自身契约，而忽略某强度的模型会相应地报告用量。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

本开发备注是非权威的工作上下文：未决方向与维护者笔记。已发布行为与已采纳的理由位于上述各节、包代码与所链接的 Agent Notes 中。

- `DEFAULT_API_URL` 指向本地开发网关，与身份权威及 Web 包已解析的值一致。网关运行在别处的部署需覆盖 `apiUrl`。
- 本路由复用而非组合 `DeepSeekAdapter`，因此该适配器协议行为的变化会自动到达本路由。这是有意保留的耦合；另一方案——再写一个适配器——被否决，因为它会是一份带着自己那份缺陷的副本。

</details>

**运行时不变式：** 不发布伴生入口。本包没有独立事件序列或可变数据关系，相关约定在所属 seam 强制执行。
