---
description: "面向 Grok Build、ChatGPT Codex 与 Claude Code 的编码订阅 OAuth：模型路由、额度上报、图像与视频生成，以及模型提供方设置页中的一个分组。"
kind: "package-bundle"
---

# @aeven/subscription-auth

[English](README.md) | 中文

## 概述

`avn-subscription-auth` 让部署用操作者已经付费的编码订阅来驱动模型，而不是使用 API key。它通过 OAuth 登录 Grok Build、ChatGPT Codex 与 Claude Code，把每个订阅发布为一条 LLM 路由，上报剩余额度，并向 media seam 贡献图像与视频生成。模型提供方设置页中的「订阅」分组在浏览器中承载登录与额度，与 API 密钥提供方使用相同的行。它属于 experimental：不进入正式发布，并且调用的是供应商未公开文档的私有端点，因此供应商的一次改动就可能在没有预告的情况下让某条路由失效。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

把这个包作为 bundle 加入某个 profile。它的 `cordis.patch.yml` 插入 `llm-grok-build-oauth` 行且不改变部署的默认模型；部署自己的 patch 层在其之后应用并优先生效。

### 何时选择它

当操作者持有 SuperGrok、ChatGPT Plus/Pro 或 Claude Pro/Max 订阅，并希望在不配置 API key 的情况下使用这些模型时选择它。不要用它把这些订阅提供给本部署之外的任何东西：各供应商的条款约束着一个订阅可以驱动什么，而这个包走的是各供应商自己的客户端路由，而非公开 API。

### 登录

每个供应商都在 设置 → 模型提供方 的「订阅」分组中登录。**登录** 会在新标签页中打开供应商的登录页，并通过 harness 的本地回调完成，因此无需在设置页中输入任何内容。Grok Build 与 Codex 另外提供 **使用代码登录**，这是一个设备码流程，会显示一个需要在供应商页面输入的代码；当浏览器不在 harness 所在主机上时它排在最前，因为本地回调会到达错误的机器。Claude Code 仅支持浏览器。登录完成后，设置页会关闭它打开的供应商标签页；Grok 的授权页会自行确认 code 已送达，因为本地回调允许 `https://accounts.x.ai` 读取它的应答。凭据按供应商各存一个文件，位于 `${AVN_HOME}` 下，仅操作者可读，且从不在浏览器中呈现。

### 配置

| Key | Default | Meaning |
|---|---|---|
| `imagineTransport` | `auto` | `xai-api` 使用已配置的 `XAI_API_KEY`；`grok-build` 使用订阅的 OAuth token；`auto` 优先用 key，否则回落到订阅。 |
| `imagineApiTimeoutMs` | `180000` | Imagine API 请求上限。订阅路由经 Grok Build chat proxy 代理生成，比直连 xAI API 更慢。 |
| `capabilities.codexSearch` | `false` | 发布由 Codex 支撑的网页搜索，会消耗 Codex 额度。 |
| `capabilities.codexFast` | `false` | 当在线目录确认优先资格后发布 Codex Fast 路由。 |
| `capabilities.searchResults` | `5` | 该搜索返回结果数量的上限。 |

图像与视频生成不可配置。它们属于订阅本身而非部署选择，因此固定开启、上限取供应商最大值，设置页也不再提供这些开关。

-----

<a id="understand-the-implementation"></a>
## 理解实现

每个供应商是一个 `OAuthProviderSession`，其下是按供应商划分的凭据文件；Grok 另有 `GrokBuildSession`。每条路由提供其内置目录：不会自动获取供应商的模型列表，之前获取并缓存的列表也不会恢复。`createCodingOAuthAdapter` 把每个已登录供应商发布为一条 LLM 路由，并按请求解析一个已刷新的 access token。

额度上报把三份互不相同的供应商载荷归一到一个投影（`src/usage-view.ts`）：无论供应商怎么报，都化为每个窗口的剩余百分比与以秒为单位的重置时刻。Codex 在 `wham/usage` 返回已用百分比窗口与积分余额，Claude 在 `/api/oauth/usage` 返回三个使用率桶与一份每月额外用量额度，Grok 在 `/billing?format=credits` 返回一个计费周期、按产品的拆分与预付分值余额。金额余额带有其 ISO 4217 币种，并以该币种的最小单位表示。每个 reader 对成功结果只做短暂缓存，对拒绝结果缓存得久得多，因为只有登录状态变化才能改变一次拒绝。

媒体生成通过两条路到达模型：harness 的 media seam，由 `image.generate` 工具带供应商选择器驱动；以及这个包自己的 Imagine 与 Codex 图像工具。工具的对外暴露以凭据就绪状态为准，而不是以某个设置为准——后端没有可用凭据的工具会被撤下，而不是先提供再失败。

**运行时不变量：** 不发布 companion。OAuth 会话与凭据文件没有可供比较的、由本包独立持有的观察值；能力、路由和工具贡献则由各自的 registry 持有，并由生命周期测试覆盖。

-----

<a id="further-exploration"></a>
## 进一步探索

- [`packages/media`](../../media/README.zh.md) — 这些 provider 注册进入的 seam。
- [`packages/llm`](../../llm/README.zh.md) — adapter 在其上发布路由的 LLM capability。
- [Experimental subtree rules](../AGENTS.md) — experimental 状态放宽了什么、没有放宽什么。

-----

<a id="model-experience"></a>
## 模型体验

### 订阅模型与媒体工具

#### 模型看到什么

已登录的供应商表现为普通的 LLM 路由，模型通过常规模型选择即可到达，不需要知道这个包的任何词汇。它可能额外看到的可选工具是 `codex_image_generate`、`codex_image_edit`、`grok_imagine_image`、`grok_imagine_video` 与 `grok_imagine_video_status`，每个仅在其后端持有凭据期间才对外暴露。生成类工具返回一段简短文本摘要以及图像附件引用；浏览器从工具结果渲染它们，因此回复不再用 markdown 重复一遍。

#### Token 影响

工具 schema 是唯一的常驻成本，且只对凭据使其可用的会话生效；撤下一个工具会把它的 schema 从目录中移除。额度读取从不进入模型请求。生成的图像以附件引用而非内联字节进入 transcript，因此其成本是引用与摘要行，而不是媒体本身。

#### KV Cache 影响

工具的对外暴露会改变工具目录，而目录属于被缓存的前缀：会话中途的登录或登出会撤下或加入一个工具，并从该点起使前缀失效。普通的额度刷新与能力读取不会，因为二者都不进入模型请求。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **供应商端点是私有且无文档的。** 额度读取与 Grok Build 媒体路由调用的是各供应商自己的客户端端点。供应商可能在没有通知的情况下更改或撤除其中之一，失败表现为工具被拒绝，而不是构建错误。
- **Grok Imagine 的图像模型有两个名字。** 直连 xAI API 称其为 `grok-imagine-image-2.0`，Grok Build proxy 称其为 `grok-imagine-image-quality`。两种写法都被接受并归一到当前 transport，因此模型选择器提供任一 id 都能在任一凭据下工作。
- **未观察 Grok 的账单跳转设置。** 官方客户端会对 remote settings 带有 `usage_billing_redirect_url` 的账户隐藏额度。这个包不拉取 remote settings，因此这类账户会看到其供应商客户端本会拒绝展示的数字。
- **兼容性 BOM 现已冗余。** `compatibility/avn-bom.json` 与 `AVN_EXACT_BOM` 用于检测跨仓库版本漂移，而 workspace 解析已使之不可能发生。它们保留到这个包在 harness 中稳定下来，然后移除。
- **这个包横跨多个产品角色。** OAuth 会话、一个 LLM adapter、媒体 provider、工具与一个客户端 UI 都在同一个包里。预期它会在从 `experimental/` 提升之前按这些角色拆分。
- **凭据文件是唯一的持久状态。** 它们保存着 refresh token；移除某个供应商的最后一个账户会删除它的文档——这是一次完整登出，同时丢弃 refresh token，只能通过重新在浏览器中登录来恢复。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文 — 点击展开</summary>

无。

</details>
