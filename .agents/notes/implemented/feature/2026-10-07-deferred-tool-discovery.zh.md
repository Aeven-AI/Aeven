# Agent Note: 不会让请求或提示词缓存溢出的延迟工具发现

Status: implemented

[English](2026-10-07-deferred-tool-discovery.md) | 中文

## Problem

一个运行在 Aeven-1.0-Flash 上的 Web 会话（2026-10-07）请求在用户能看到的 Chrome 中打开一个页面。它的日志记录了延迟工具加载如何失败。由于 `@aeven/tool-search` 只延迟 `mcp__*` 名称，请求中始终带着 62 个工具。为寻找浏览器而做的三次关键词搜索加载了 68 个无关的连接器工具：查询 "chrome devtools navigate page browser window" 通过描述中的单个词匹配到了 Telegram 的 `get_history`（"within a time window"）以及 GitHub、OneDrive 和 Outlook 的工具，而每个匹配都在会话剩余时间里保持加载。下一次请求声明了 130 个工具，网关拒绝了它（`tools may declare at most 128 tools`）。

浏览器工具在那个会话中从未存在。八个请求头中都没有 `chrome_devtools` 与 `playwright`，可 `preview_status` 报告了 `toolPrefix: mcp__chrome_devtools__`，`web_fetch` 指引也点名了这两个前缀，于是模型花了好几个轮次猜测确切名称，而 `select:` 只能回答一句笼统的 "No deferred tool is named …"。MCP 监管器在十次重连失败后便永久停止，因此重启 Chrome 也无法让这些工具回来。

每次成功的加载还会丢弃提示词缓存。在第 6 轮中，缓存前缀两次从约 47 万 token 跌到 11,136，因为工具列表在渲染出的提示词中位于对话之前；这两次加载重新计费了约一百万输入 token。索引把已连接的账户命名为 `mcp__account_<24 位十六进制>__{…}`，因此 Telegram、WhatsApp、GitHub 与 Outlook 只能靠 id 区分，较长的名称还会被截断并加上哈希（`list_reposit_26fbeb82e766`）。

PTC 模式本可以在不触碰请求的情况下承载延迟工具，但它的 TypeScript SDK 把这 68 个连接器工具中的 65 个渲染成了 `args: unknown`：强制子集之外的任何关键字（类型数组、`anyOf`、`minimum`、`$schema`）都会让整个 schema 失效。程序 600 秒的墙钟还会把用户决定一项审批的时间算进去。

## Decision

### 搜索只列出，`select:` 才加载

`tool_search` 关键词查询最多列出 `maxResults`（默认 8，最多 20）个工具及各自描述的第一句话，不加载任何工具。名称与 namespace 标题的匹配优先于描述的匹配，唯一证据只是描述中一个词的工具不会被列出。`select:<names>` 负责加载；`restart:<server>` 重新连接一台 MCP 服务器。会让一次请求声明超过 `maxRequestTools`（默认 128）个工具的原生 `select:` 会连同数量一起被拒绝；仅未延迟工具就超过该上限的提示词组装会在组装时失败，而不是到网关才失败。

### 带标题、固定不变并配有更新消息的索引

`deferred-tools` 段落在每个 namespace 的标题下列出每个延迟工具：标题取 MCP 服务器的 `title`，原生工具则取配置的 `groups` 标题。它还列出已配置但未在服务的 MCP 服务器，附带状态、最近一次错误与重启查询。该段落在 agent 的首次请求时渲染，在压缩前逐字节保持不变；之后的变化以一条被记录的 `agent/pre-step` 用户消息送达模型，其中带有完整的替代索引。服务器状态来自按 agent 作用域分发的 `mcp/servers` waterfall：每个 `@aeven/mcp-client` 实例都以其标题、状态（`connecting`、`connected`、`retrying`、`failed`）、最近一次错误，以及一个以全新尝试预算重新连接的 `restart()` 作答，即使监管器已经放弃也同样有效。

### 加载到 `run_code` 中让请求保持不变

当 agent 的请求呈现 `run_code` 时，`select:` 以代码运行时的语言返回 SDK 声明，模型在程序中调用这些工具。请求的工具列表与系统提示词都不改变，因此一次加载既不造成缓存未命中，也不占用请求上限的余量。子调用以真实名称走完整的工具流水线，因此账户审批策略原样生效。`aeven` preset 的 `tool-presentation` 行选择 `mode: both`，并保持禁用，直到发现评估表明 Aeven-1.0-Flash 能可靠地编写这类程序；默认仍是原生加载工具。

### 为每个 schema 提供有类型的 SDK

`projectRenderableSchema`（`@aeven/tools`）在 TypeScript 与 Python 渲染器生成类型之前，把任意 JSON Schema 逐节点映射到强制子集。类型数组、`anyOf`、`nullable` 与单成员 `allOf` 变为联合类型；本地 `$ref` 在循环保护下解析；被丢弃的约束变为文档提示；不受支持的节点只放宽它自己。在该会话的 68 个连接器 schema 上，有 67 个渲染出有类型的参数（剩下的 `get_draft` 本身没有参数），体积为其 JSON 的 0.83。某次运行的子调用等待审批期间，注册表保持该次运行的 `CodeRunPauses`，worker 运行时在暂停期间停止墙钟。

### 如实的可用性与可读的名称

当没有任何已注册工具带有浏览器前缀时，`preview_status` 报告 `hostBrowser.toolsUnavailable`，附带服务器的状态、错误与重启查询；`web_fetch` 指引只在每台浏览器服务器的工具已注册时才提及它。账户连接器以 `<provider>_<连接器 id 的前 8 位十六进制>` 挂载，标题为 `<Provider> (<连接器名称>)`，因此索引读作 `Telegram (Olivier): mcp__telegram_1a2b3c4d__{…}`；审批策略依据同一名称解析连接器。`aeven` preset 延迟内置的专用分组（媒体生成、邮件、记忆、设备、除 `preview_status` 外的预览浏览器、位置、subagent 控制与 workflow），每次请求只保留 23 个工具。

### 恢复与压缩

原生加载集合从原始的 `tool/call` 与 `tool/result` 事件重建，压缩不会改动这些事件。来源为 `compact` 的 `agent/session-start` 会丢弃固定的索引，因此下一次请求会渲染当前的索引。

## Alternatives considered

**Codex 的按轮次工作集**——在每个用户轮次清空已加载的工具并重新发现，可以限制请求规模，但在前缀缓存的提供方上，每次清空与每次重新加载都会重新计费整段对话；该会话测得一次这样的未命中约为 46.5 万 token。固定的工具列表加上历史中的声明能在不产生任何未命中的情况下限制请求规模。

**新的 `call_tool(name, args)` 分发器**——固定的传输工具同样能让请求保持稳定，但审批策略与 UI 都以实际执行的工具名称为键，因此它需要一次在身份确定之前的调用改写，而 [pre-tool input rewrite note](../../proposed/feature/2026-06-30-pre-tool-input-rewrite.zh.md) 尚未交付这一点。`run_code` 已经以真实名称通过完整流水线分发子调用。

**接近上限时淘汰最久未用的加载**——能让原生加载在上限处继续工作，但淘汰会改变工具列表（又一次缓存未命中），还会悄悄移除模型可能仍要调用的工具。带上数量拒绝加载，让模型自己选择。

**用语义检索做搜索**——基于嵌入的排序能匹配换了说法的请求，但测得的失败是词法层面的（单个常见词加载了无关工具）；按名称与标题加权的确定性排序无需依赖模型就能修复它。若评估发现换说法导致的遗漏，它仍可启用。

**每次变化都重写索引段落**——比更新消息简单，但任何服务器连接或丢失都会让缓存的提示词从系统段落起失效。

**用按 agent 的工具限制代替延迟**——按人设隐藏工具会把它们同时从请求和索引中移除，模型就完全无法发现它们。

## Consequences

请求不再可能因加载而超过工具上限，关键词搜索也不再累积无关工具。`aeven` preset 中始终发送的工具从 62 个降到 23 个。在 `run_code` 下，加载花费一个模型步骤且没有缓存未命中；在原生加载下，每次加载仍会让缓存失效一次，评估将以此与 Aeven-1.0-Flash 编写程序的可靠性相权衡。worker 运行时每次 `run_code` 约增加 13 ms，每个子调用走完整流水线约增加 0.1 ms，而该会话的模型步骤中位数为 9.3 秒。

模型现在要多花一步才能用到 `preview_click` 这类延迟的内置工具。账户工具名称从 `mcp__account_<id>__` 变为 `mcp__<provider>_<id>__`；加载过旧名称的已记录会话在恢复时会丢失这些加载。`mcp/servers` 的路由项是手动加入 `scoped-events.generated.ts` 的，因为 `gen-scoped-events` 在这个分支上会因两个既有违规（`capabilities/changed`、`message-feedback/changed`）而失败。

## Testing

`packages/core/tool-search/tests/tool-search.spec.ts` 覆盖索引文本、分组、未在服务的服务器、带更新消息的固定索引、压缩、关键词排序与上限、原生与 `run_code` 加载、请求上限、重启，以及从原始事件重建加载集合。`schema-projection.spec.ts` 以一个真实的 Telegram MCP schema 固定投影结果。`reconnect.spec.ts` 覆盖连接状态与 `restart()`；`runtime.spec.ts` 覆盖暂停的墙钟；`ptc.spec.ts` 覆盖审批暂停；tool-browser 与 tool-web 的测试套件覆盖可用性报告。
