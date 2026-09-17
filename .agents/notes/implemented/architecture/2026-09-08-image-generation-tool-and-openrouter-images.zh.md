# Agent Note：图像生成抵达模型，OpenRouter 提供服务

Status: implemented

[English](2026-09-08-image-generation-tool-and-openrouter-images.md) | 中文

## 问题

[媒体 Seam](2026-09-03-generated-media-capability-seam.zh.md) 及其 [Provider](2026-09-03-generated-media-providers.zh.md) 交付时完整却无法触达：`packages/media/` 之外没有任何东西依赖 `avn-media`，没有 Profile 挂载它，也没有工具调用它。在 Web 客户端请求图像的人只能从基于订阅的厂商工具获得图像生成；BYOK 部署持有的两个 API Provider——OpenRouter 与 DeepInfra——虽有可用的 Seam Provider，却没有任何请求能够抵达。

把 OpenRouter 的图像模型选作 *chat* 模型会以 `HTTP 404: No endpoints found that support tool use` 失败，因为实时目录把图像输出模型物化成了 chat 模型。那是 `avn-llm-pi-ai` 中另一个独立缺陷，在此记录是因为它正是图像生成从外部看到的样子，且本次改动并不修复它。

## 决策

**一个工具 `generate_image`，独立成包。** `avn-tool-media` 是该 Seam 唯一面向模型的接触面。它解析请求、调用 `ctx.media`，并经 `ctx.attachments` 存下每张图像。它不注册任何呈现：已结算结果的图像块本就会在工具卡片中渲染，因此渲染决策仍留在[那篇 Note](2026-09-02-tool-result-images-render-in-the-card.zh.md) 放置它的地方。

**生成的字节成为持久附件，绝不是文件或 URL。** 这正是图像出现在会话中、而不是变成一个模型还得去描述的路径的原因，也正是基于订阅的图像工具已经在用的同一机制。

**OpenRouter 图像走专用的 `/api/v1/images` 路由，而非 chat completions。** OpenRouter 的新图像模型只加在那里，而其 chat 路由会在工具兼容性路由步骤上拒绝它们。`avn-media-pi-ai` 经 chat-modality 传输触达同一账号，面对的是冻结在已安装 pi-ai 中的模型列表，因此它是通往同一处、却不再收到新模型的第二条路。

**Seam 的字节标注移入 `avn-media`。** 两个 Provider 都必须标注其路由未可靠说明格式的字节，而 `GeneratedMedia.mediaType` 是 Seam 自己的字段。`imageMediaType` 由 Seam 导出，而不是复制进第二个 Provider。

**无法存储的媒体类型在工具处连同类型名一起拒绝。** 第一版附件路径存储四种位图格式。OpenRouter 按请求提供 SVG，无法识别的签名保持为 `application/octet-stream`；在工具处点名该类型，胜过存储层一句无信息的拒绝。

## 影响

`generate_image` 是加入而非取代基于订阅的图像工具。名称不冲突，凭据互不相关，模型按请求自行选择，因此同时持有订阅与 API Key 的部署可以触达全部工具。

挂载两个图像 Provider 的部署必须固定其一，或在 Seam、或在工具上。Seam 在选择存在歧义时会报错而不是猜测，因此这会在首次调用时响亮失败，而不是悄悄选一个。

`avn-media-pi-ai` 与 `avn-media-openrouter` 现在都以默认 id `openrouter` 注册，同时挂载两者的组合必须给其中之一改名。pi-ai 图像路径是否还有存在理由，作为未决问题记录在该包的开发说明中。

参考图与视频对模型仍不可达。Seam 两者都承载；暴露它们是工具接触面的决定，而非 Provider 的决定。

## 验证

改动涉及的各包在语句、分支、函数与行上的单元覆盖率均为 100%：图像路由按其自身字段名的映射、声明与嗅探两种媒体类型、被跳过与为空的响应行、两种凭据来源、两个方向的参数默认值填充、每一种可存储与被拒的媒体类型，以及断言已存字节与已渲染图像块的端到端执行。

该 Seam 已挂载真实插件针对 DeepInfra 线上 API 做了端到端验证：`black-forest-labs/FLUX-1.1-pro` 返回了 1024×1024 的 JPEG，并用 `file` 确认。该次运行同时验证了共享嗅探器，因为该路由对一个默认 PNG 的请求回以 JPEG，而字节被正确标注。

OpenRouter 图像路径抵达了线上路由，并被以 `HTTP 401: API key expired` 拒绝——过期的是该账号的 Key，而不是请求本身。路径错误本会返回 404，因此端点与请求已确认，而解码路径在拿到有效 Key 之前仍仅由单元测试覆盖。

## 备选方案

**安装第三方图像插件。** 已否决：那会为了取得一个其后端本仓库已经拥有的工具，额外引入提示词库、图库、批量工作台与本地工作流接触面；而且它的 OpenAI 兼容中继提交到 `{baseURL}/images/generations`，那并不是 OpenRouter 提供服务的路径。

**经 `avn-media-pi-ai` 触达 OpenRouter 图像。** 已否决：无需新代码，但遗留传输层加上冻结在已安装 pi-ai 中的模型列表，意味着不升级依赖就永远看不到新模型。

**把该工具放进 subscription-auth 插件、与厂商图像工具并列。** 已否决：那个包的主题是通过 OAuth 针对某一厂商订阅取得的凭据，且其每个工具都绑定一个硬编码的厂商传输层。基于 Seam 的 BYOK 工具两者皆不共享，应与它所调用的 Seam 同处。
