# Agent Note: 以可展开卡片呈现订阅提供方并逐个选择模型

Status: implemented

[English](2026-10-02-subscription-providers-model-selection.md) | 中文

## Problem

模型提供方页面中的「订阅」分组把 Grok、Codex 与 Claude 显示为平铺的行：登录按钮（包括单独的 **使用代码登录**）位于收起的行上，用量是第二层展开，且没有任何一行列出其模型。每个订阅都提供其完整的内置目录：用户无法关闭某个模型，供应商新增的模型要等到发布后才出现，被撤下的模型仍留在选择器中。订阅的图像模型（Grok Imagine、GPT Image 2）只能通过各自的工具使用，从不进入 harness 的图像模型列表。在 Anthropic 自家应用之外使用 Claude Pro/Max 的 OAuth 会计入用量积分而非套餐额度，因此 Claude 那一行实际上是挂着订阅名义的 API key 计费。

## Decision

**页面名为「提供方」，每个订阅是一张可展开的卡片。** `ui-settings-models` 把其分区命名为「提供方」。`avn-subscription-auth` 依次渲染 Grok 与 Codex 的卡片，采用 Plugins 卡片的取值：标题行写明提供方、其套餐与登录状态；展开的卡片承载登录步骤或用量与模型；底部承载 **登录**、**取消登录** 或带内联确认的 **退出登录**。收起的卡片不带任何操作。同一个 **登录** 按钮在 harness 所在主机上启动浏览器流程，从另一台机器打开页面时则启动设备码流程，因此单独的代码登录按钮被移除。

**移除 Claude。** 其路由、提供方定义、用量 reader 与积分重映射均被删除；`CODING_OAUTH_ROUTES` 为 `grok-build` 与 `codex-oauth`。

**选择以排除项保存。** `ModelSelection` 把每个提供方中用户关闭的模型 id 保存在 `${AVN_HOME}/subscription-model-selection.json`。两个会话都通过它过滤所提供的模型，因此路由的模型列表、输入框的模型选择器与图像模型列表会立即随改动更新。新模型默认选中；被撤下的模型直接消失，不影响其他选择。状态路由为每个提供方报告带有 `imageInput`、`imageOutput` 与 `selected` 的模型，`POST /plugins/dsh-grok-build/oauth/models` 替换某一提供方的选择。

**模型列表自动同步。** `startModelSync` 在启动时、每次登录后以及每隔 `modelSyncIntervalMs`（默认 30 分钟）读取 Grok 的 `/v1/models` 与 Codex 的 `/backend-api/codex/models`（去掉 Codex 隐藏的条目）。每份列表缓存在 `${AVN_HOME}` 下并在启动时恢复；读取失败时保留上一份列表。内置 pi-ai 目录不认识的 Codex id 会继承目录中最新条目的传输方式与上限，因此请求 provider 恰好提供所列出的模型。

**订阅图像模型加入图像模型列表。** `grok-subscription` 与 `codex-subscription` 注册到 `ctx.media`，只在订阅持有凭据且该模型被选中时列出其图像模型；被关闭的图像模型也会撤下对应的生成工具。`tool-media` 新增 `listedProviders`，其在线列表排在已配置的 `choices` 之后，出现在选择器、`/image-models` 与调用校验中；内置预设列出了这两个订阅提供方。这对预设明确列出的提供方推翻了 [Aeven 的两个图像模型是仅有的图像模型](../architecture/2026-10-01-aeven-image-models-only.zh.md) 中关于 media seam 的段落；Aeven Flash 仍是默认模型。

## Alternatives considered

**像 T3 Code 那样以各供应商的 CLI 作为运行时。** 本次不采用：Anthropic 目前把 Agent SDK 与 `claude -p` 的使用计入套餐额度，但曾宣布并暂缓了改为单独积分的计划，因此对 Claude 的好处可能不持久；而 OpenAI 并不限制在其 CLI 之外使用 Codex OAuth。OAuth 登录保持不变。

**保存选中的 id。** 不采用：供应商新增的模型会默认关闭，被撤下的 id 会残留在保存的列表中。

**保留单独的使用代码登录按钮。** 不采用：状态路由已经报告的访问方式决定了哪种流程能够完成，因此这不应由用户来选择。

**只把订阅图像模型注册到 media seam。** 不采用：`tool-media` 把每次选择都限制在其配置的 choices 内，这些模型会被列出却永远无法选中。

## Consequences

提供方页面显示每个订阅模型及其能力，用户的选择无需重启即可作用于路由、选择器与图像工具。列表同步会定期对两个未公开文档的供应商端点发起已认证调用；供应商的改动表现为列表过期而非清空。移除 Claude 也删除了其已存凭据的支持：已有的 `claude-code-oauth` 凭据文件不再被读取。
