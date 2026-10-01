# Agent Note: 默认提供会话检索

Status: implemented

[English](2026-10-01-session-query-by-default.md) | 中文

**已由[会话搜索保持为选择启用](2026-10-01-session-query-stays-opt-in.zh.md)取代。** 四个 preset 不再挂载该行，因此本笔记是当初为何尝试的记录，而不是已发布的组合。其中关于 profile 模块回退与快照通道的叙述，仍然描述了挂载该行需要付出的代价。

## Problem

`@aeven/session-query` 交付时是一个需要每个预设主动选用的包，而没有任何预设选用它。因此代理只能记住记忆提供者提炼出来的内容以及召回返回的内容：当有用的材料是早前对话中的某个决定、某份文件清单或某条命令时，已发布会话中没有任何途径能触及它。这些工具在生成的工具目录中被描述为模型可见，于是该目录描述的是一种没有任何 profile 实际注册的组合。

## Decision

四个已发布预设——`aeven`、`standard`、`cordis` 和 `ptc`——在 `tool-memory` 旁挂载 `@aeven/tool-session-query`。一行带来五个工具（`session_search`、`session_event_search`、`session_trace`、`session_event_trace`、`session_event_read`）与一段指引；`apps/cli/package.json` 声明该包，使已发布 profile 能解析它。

该行实测的模型可见工具描述为 1,703 个字符，约 **426 token**；实测一个回合约 19,000 输入 token，因此约占 2%，换来的是从当前会话通往本工作区早前会话的唯一路径。召回覆盖记住的事实；这一行覆盖会话记录本身。

## Alternatives considered

- **只挂载两个检索工具。** 当检索命中需要血缘或精确载荷时，事件级工具正是有用的时候；拆分这一行只会为几百个字符牺牲该能力的取证部分。
- **继续 opt-in。** 那样目录会继续描述没有任何已发布组合注册的工具，而用户必须知道某个包名才能检索自己的会话。
- **把行放进 `avn-base` 而不是预设。** 工具属于按会话；基础平面承载服务。工具行应放在代理其余模型可见行所在之处。
- **扩写指引段以逐一解释工具。** 五段描述已经说明各自返回什么；更长的指引只会把它们在每次请求上重复一遍。

## Consequences

每个已发布会话现在多提供五个工具，模型在工具选择上面临更宽的选项；这些描述是按路由顺序（`search` → `trace` → `read`）写的，而不是按枚举写的。

在已经运行的宿主中挂载一行有一个尖锐的边界。profile 的模块回退目录（`$AVN_HOME/profiles/node_modules`）在启动时依据部署声明的依赖被修复，因此在这行被声明之前启动的宿主无法解析 `@aeven/tool-session-query`：预设挂载失败，于是**该预设的每一个会话都无法恢复**（`row "tool-session-query" names a plugin that cannot be resolved`）。把该包链接进回退目录可以无需重启修复正在运行的宿主，而下一次启动会依据 `apps/cli/package.json` 自行修复。

录制会话快照会固定每一次装配出的请求，因此挂载该行会改变它们。刷新这些 sidecar 需要带模型密钥运行 `pnpm run test:snapshot:refresh`，而本检出没有该密钥：在该命令运行之前，快照通道会因新增工具保持红色。在此之前该通道已因一份过期的 `tool-jobs` 描述 fixture 而处于红色。

## Verification

`pnpm exec vitest run packages/preset/agent-presets` 在 12 个文件中通过 186 个测试。该套件的 roster 固定项列出四个预设，而当前树发布五个，因此现在也期望 `aeven`。`pnpm run verify-cordis-config` 只报告先前已存在的 `tool-call-access-policy` 映射缺口，对新行没有发现；`pnpm run verify-tool-catalog` 的失败来自早于本次变更的四个工具包（`tool-capability`、`tool-device`、`tool-memory`、`tool-search`），而不是 `tool-session-query`——生成器本就已经把它编入目录。
