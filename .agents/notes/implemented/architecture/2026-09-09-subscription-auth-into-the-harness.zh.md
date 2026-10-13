# Agent Note: 把编码订阅插件作为 experimental 包吸收进来

Status: implemented

[English](2026-09-09-subscription-auth-into-the-harness.md) | 中文

## Problem

面向 Grok Build、ChatGPT Codex 与 Claude Code 的编码订阅 OAuth 此前位于一个独立仓库，只能作为由文件系统 link 解析的 profile bundle 到达 harness。本仓库中没有任何东西提到它，因此它的打包由它自己的门禁而非本仓库的门禁来验证。

这种分离的代价大于收益。该插件固定了一份精确的 19 个 `@aeven/*` 包的 BOM，并在每次构建时重新校验，因为一次 harness 发布可能在它脚下移动。于是每次 harness 版本提升都要求那边同步发布一次，而两者之间的漂移只能通过那份手工维护的清单发现。该插件同时填充着 harness 的 seam —— `ctx.media` 的图像与视频 provider、一个 LLM adapter、一个设置页分区 —— 却无法用 workspace 解析去够到它们。

有两个缺陷直接源自这次分裂。插件提交进仓库的 `lib/` 才是 `avn web` 实际加载的产物，而它已经落后于 `src/`，却没有任何门禁察觉。它的发布校验器断言客户端 bundle 中存在某个设置开关的标记，而产品早已把该开关退役，于是构建恰恰拒绝了移除它的那次改动。

## Decision

该插件落位为 `packages/llm/subscription-auth`，npm 名为 `@aeven/subscription-auth`，`private: true`。目前它是单个包，预期在从 `experimental/` 提升之前按产品角色拆分 —— OAuth 会话、LLM adapter、媒体 provider、工具、客户端 UI。

它保留 `avn.bundle` 与 `avn.client` 两处 manifest 声明，因为 profile 正是靠它们发现一个 bundle 及其浏览器半边。它保留 `dsh-coding-oauth-core` 作为精确版本的外部依赖：那个包拥有本包所实现的路由与路径标识符，而固定它正是 ABI 门禁所检查的内容。

这次迁移是复制而非分叉。独立仓库就此退役，而不是并行维护；再留一份活跃副本只会重新引入本文所消除的那种漂移。

### harness 要求而独立仓库不要求的东西

该包在两个编译面下编译。`src/client/**` 是浏览器程序，其余是 Host 程序，因此它带有 `tsconfig.host.json` 与 `tsconfig.client.json` 两个叶子配置以及一个仅作 solution 的根配置，并注册进相应的聚合配置。测试遵循同样的拆分：伸入 `src/client/**` 的 spec 命名为 `*.client.spec.ts`，根聚合配置正是据此把它路由到客户端程序。跨面的 spec 被拆开，而不是按其中一面命名。

有三个仓库门禁拒绝了刚迁入的这个包，每一个都通过遵从而非豁免来解决。`src/bin.ts` 被删除：只有 `avn` profile 才启动应用，包自带 bin 是被禁止的。Imagine SSRF 守卫中三处做 DNS 固定的 `undici` agent 带上了 dispatcher 门禁为「自己拥有按请求传输状态的调用点」所定义的 `proxy-exempt:` 标记。生成的 tsconfig 别名改为手写，因为包名与其目录名不一致。

### 迁移过程中定下的行为

媒体生成不是部署选择。图像生成、图像编辑与视频固定开启、上限取供应商最大值，在用户 patch 之后展开，因此任何已存文档都无法把它们调低，并从 schema 与设置页中彻底移除。

工具的对外暴露以凭据就绪状态为准，而不是以某个设置为准。后端没有可用凭据的工具会被撤下，而不是先提供再失败 —— 后者这种拒绝，模型只有花掉一轮才能发现。就绪状态是一个缓存视图，在登录、登出与凭据变更时刷新，并通过既有的 `CapabilityRuntimeState.refresh()` 发布。

额度上报是覆盖三份互不相同的供应商载荷的同一个投影：无论各家怎么报，都化为每个窗口的剩余百分比与以秒为单位的重置时刻。一次拒绝的缓存时间远长于一次读数，因为只有登录状态变化才能改变它。已登录的供应商卡片从卡片标题展开这份读数，与插件卡片展开其设置的方式相同。

OAuth adapter 注册的是本包自己拥有的路由列表 —— `grok-build`、`codex-oauth`、`claude-code-oauth` —— 而不是 core 的 `CODING_OAUTH_ROUTES`，后者还列出了 `kimi-code-oauth`。`llm.registerAdapter` 会在提交任何路由之前校验整组路由，因此只要有一条路由是 adapter 无法描述的，所有订阅路由都不会被注册；`tests/llm-registration.spec.ts` 让插件对着真实的 LLM 注册表启动，以守住这一点。

对于只在使用额度（usage credits）下才提供某个模型的 Claude 套餐，服务端返回 HTTP 429 `rate_limit_error`，并带有 `error.details.error_code: "credits_required"`。alias adapter 把这种拒绝映射为 `QUOTA`（该路由的重试策略不包含它），并把 JSON 响应体替换为点出模型名的提示：购买额度是账户层面的操作，任何重试都无法代劳。

Claude 没有设备码流程，因此一次进行中的 Claude 浏览器登录也接受用户粘贴的供应商最终页面地址，用于浏览器无法到达 Host 本机回环回调的情况。Codex 与 Grok 用各自的设备码流程覆盖这种情况，不显示粘贴输入框。

## Consequences

BOM 机制现已冗余 —— workspace 解析使跨仓库漂移不可能发生 —— 仅保留到这个包稳定下来，然后与 `AVN_EXACT_BOM` 一并移除。

既有安装把 profile 指向的是独立包名。把 profile 重新指向 workspace 目录是可行的，`workspace:^` 的 peer 范围会经由 harness 自己的 `node_modules` 解析；未重新指向的 profile 会继续加载已退役的副本，并且收不到任何改动。

测试套件随代码一同迁移：45 个文件、527 个测试，按定下的行为更新而非删除。在同一次改动中移除七块功能 —— 本地 API 网关、Antigravity、CLI 凭据导入、Kimi、模型选择、已保存账户列表、版本页脚 —— 正是这次更新的主要内容。

## Alternatives considered

**在迁移过程中就拆分为角色包。** 因时序而非价值被否决：一边拆分一边换仓库，会让任何东西直到最后一刻都无法编译或运行。整体落位、再在 harness 内部拆分，能让每一步都可由本仓库的门禁验证。

**保留独立仓库作为源并 vendor 一份构建产物。** 否决。它保留了同步发布与 BOM，也保留了那种把某个功能对运行中的产品隐藏起来的「提交产物过期」问题。
