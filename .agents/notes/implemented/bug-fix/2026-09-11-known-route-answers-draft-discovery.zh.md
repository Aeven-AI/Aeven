# Agent Note: 已知路由为草稿发现作答

Status: implemented

[English](2026-09-11-known-route-answers-draft-discovery.md) | 中文

## 问题

Models 页面的"获取可用模型"操作对已知路由永远无法成功。`discoverModels` 只从发现请求本身读取端点与协议，并在两者都未给出时拒绝该请求，而 Models 页面发送的是路由 id 加上表单当前显示的内容。对于只写了 `apiKeyEnv` 的 profile——这正是已知路由的全部用户可见步骤，因为表的其余部分由表拥有——表单不显示端点也不显示协议，因此草稿两者皆无，该操作以 `pi-ai ships no catalog for provider "deepinfra", so its models can only come from its endpoint; set a baseURL, or enter this provider's models by hand` 失败。Host 侧的已存 profile 查询无法弥补这一缺口：它回答的是部署标头与惰性凭据，从不回答端点。把表中的端点与协议手工填入的同一次调用，从一份记录的 DeepInfra 列表中回答了 191 个模型，其中 85 个是该路由的文本协议无法调用的语音、嵌入、图像或视频条目；实时刷新已经通过 `LiveCatalogRoute.requireTags` 把这些条目丢弃，因此两条路径对同一条路由服务哪些模型给出了不一致的答案。

## 决定

`discoverModels` 读取 `knownRoute(request.provider)`，并用该条目补全草稿：当请求两者都未给出时，条目的 `api` 与 `baseURL` 顶替其上，这与 `resolveProfiles` 从同一条目读取同样两个字段、以补全只提供凭据的已存 profile 完全一致。草稿自己给出的值仍然优先，因此被指向代理的已知路由会在草稿所指之处被询问；空白值算作已给出而非省略，因此被清空的字段会作为它本就无法使用的端点被拒绝，而不会静默地落到表上。

该回退位于 `src/discovery.ts`，而不是插件的注册处。注册处提供的是只有 Host 持有、且草稿不得携带的内容——已存凭据与部署标头；而端点、协议与标签要求是该路由的公开事实，只取决于路由键，因此直接调用该模块的调用方得到的答案，与通过 `ctx.llm.discoverModels` 调用的调用方一致。

当草稿没有给出自己的标签时（它永远无法给出：发现请求没有承载标签的字段），候选会按该路由自己的 `requireTags` 过滤。`src/live-catalog.ts` 中的 `carriesTags` 是这一信号的唯一归属。它读取 `openai-models` 文档发布的 `metadata.tags`；[实时刷新](../architecture/2026-08-28-live-provider-model-catalog-refresh.zh.md)通过它过滤自己要物化的条目，草稿发现通过它过滤自己要提供的候选，因此 `requireTags` 在两条路径上选出同一批模型。表中没有描述的路由不要求任何标签，会保留其端点发布的每一个条目，与以往完全一致；已安装目录描述的路由仍由该目录回答，不发网络请求。

## 验证

`tests/discovery.spec.ts` 新增四个用例。一个只点名 `deepinfra` 的请求会发往 `https://api.deepinfra.com/v1/openai/models`，返回所记录文档中的两个 chat 条目，并丢弃其语音、嵌入与图像条目。一个仅由 `{ apiKeyEnv: DEEPINFRA_API_KEY }` 挂载的路由会带着其已存凭据经同一端点作答，这正是所报告的缺陷。草稿自己给出的端点与 `anthropic-messages` 优先于表，其条目仍按该路由的标签过滤。表中没有描述的提供方会保留每一个已发布条目，无论其是否带标签。

deepinfra 夹具是 `tests/fixtures/model-listings/deepinfra-2026-09-11.json`，即一份记录的列表裁剪为六个条目，各条目的字段保持记录原样。对包含 191 个条目的完整记录文档，同一次调用返回 106 个 chat 模型，这正是刷新为该路由物化的结果。

## 考虑过的替代方案

**在插件的注册处补全草稿。** 注册处已经在构建已存 profile，因此可以在调用 `discoverModels` 之前把已知路由条目展开到请求上。它落选是因为标签要求必须在解析列表的过程中应用，而该过程位于 `discoverModels` 内部，这会使该路由的事实被两处读取；也因为该模块自身导出的入口对同一请求仍会失败。

**通过 `StoredModelDiscoveryProfile` 携带端点。** 该接口的存在是为了承载草稿无法携带的 Host 侧输入。把公开已知的端点与协议加进去，会为一个请求本就能声明的字段扩大它，而且它无法覆盖尚未有 profile 声明的路由——在那里表是唯一来源。

**在发现解析器内部按 id 判断并丢弃非 chat 条目。** 基于 id 的启发式会与刷新对同一份文档的判断不一致，而文档本身就明确写出了能力标签。

## 后果

仅配置了凭据的路由可以被询问，且提供给用户采纳的候选正是该路由能够服务的模型：所记录的 DeepInfra 文档给出其 106 个 chat 模型，而不是全部 191 个条目。草稿发现与刷新现在共用同一个标签信号，因此若某种已发布布局的标签位于别处，只需让 `carriesTags` 认识一次，而不是两处。

来自 `openai-models` 端点的候选仍然不带容量信息，因为该布局把容量嵌在 `metadata` 下，而列表解析器读取的是顶层容量字段。因此从这类列表采纳的模型会先取该路由的 `defaultContextWindow` 与 `defaultMaxTokens`，直到它自己的条目给出更好的值；这一缺口早于本次改动，按原样保留。

客户端没有任何改动：Models 页面本就会省略空白的端点与协议，而不是把它们发送出去，因此该修复完全位于 Host 侧。
