# Agent Note：Aeven 的两个图像模型是仅有的图像模型

Status: implemented

[English](2026-10-01-aeven-image-models-only.md) | 中文

## 问题

[图像生成工具](2026-09-08-image-generation-tool-and-openrouter-images.zh.md) 与 [生成媒体 provider](2026-09-03-generated-media-providers.zh.md) 让每个已挂载厂商的图像模型都可被触达。向 Aeven 请求一张图像会打开一个包含三家厂商七个模型的选择器——Grok Imagine、三个 DeepInfra FLUX 模型与三个 OpenRouter 模型——外加一个"Other"选项，列出每个已挂载 provider 发布的每个模型，其中包括订阅插件注册进 seam 的 Grok Imagine 与 GPT Image 条目。它们都不是 Aeven 模型，每个都需要用户未必持有的厂商密钥或订阅，而且选择器在第一次生成之前就会弹出。与此同时，Aeven 网关早已在 `POST /v1/images/generations` 上提供 `Aeven-1.0-Image-Flash` 与 `Aeven-1.0-Image-Pro`，却没有任何 Aeven provider 能触达它。

网关还以计价标志 `pixelPriced` 来决定每个模型接受哪些选项：任何按像素计价的模型都会拒绝 `background` 与 `optimize_prompt_mode`，而且只要发送了显式尺寸，参考图就被命名为 `input_image_N`。

## 决定

**`avn-media-aeven` 是 Web 组合挂载的唯一图像 provider。** 它在 `ctx.media` 上注册 `aeven`，以已登录的 Aeven 会话作为 bearer 经网关提供这两个 Aeven 模型——与 `llm-aeven` 及 Aeven 网页搜索出示的是同一凭据——并在每次生成时为发起生成的 Session 的所有者解析该会话，因此不持有任何厂商密钥。DeepInfra 与 OpenRouter 的媒体行已从组合中移除。

**目录随包内置并始终提供。** `available()` 始终为真，`listImageModels` 由 `AEVEN_IMAGE_MODELS` 作答，理由与 [`llm-aeven`](../../../../packages/llm/llm-aeven/README.zh.md) 内置其聊天目录相同：网关的 `GET /v1/models` 按权益限定，不适合作为每个账号都读取的菜单的输入。缺少登录或套餐由生成本身报告，并指明补救办法。

**`choices` 是完整的可选集合，在请求解析时执行。** 内置 Preset 列出 Flash 与 Pro；`resolveRequest` 拒绝任何其他模型，因此选择器、`/image-models` 以及调用中指明的模型都无法选中其他模型。"Other — list every image model"这一出口已被移除。Preset 默认 Flash 并设置 `confirmModel: false`，因此第一次生成不弹窗，`/image-model` 更名为 `/image-models`，作为更改已存储选择的入口。

**订阅插件不再向媒体 seam 注册 provider。** 其 Grok Imagine 与 Codex 工具保留；只移除它们向 `ctx.media` 的重复注册，因为 seam 的图像模型现在属于部署自己，而该处按订阅出现的条目就是一个"其他模型"。[以可展开卡片呈现订阅提供方并逐个选择模型](../feature/2026-10-02-subscription-providers-model-selection.zh.md) 恢复了这两项注册，且只通过 `tool-media` 显式的 `listedProviders` 提供、只在用户保持该模型选中时可用。

**`generate_image` 可以使用参考图与背景选项。** `reference_images` 接受经由 `ctx.fs` 读取的路径，既涵盖工作区文件，也涵盖模型看到的对话图像的规范化副本；`background` 映射到新的 seam 字段 `MediaImageRequest.background`。该工具去掉了没有任何 Aeven 模型接受的 `provider`、`aspect_ratio`、`resolution` 与 `seed`，其描述列出每个 choice 及其选项，使模型知道只有 Pro 具备背景选项。

**网关的目录条目声明每个模型的选项。** `inputImageFields`、`backgrounds` 与 `optimizePromptModes` 取代 `pixelPriced` 判断；规范化器按名拒绝模型没有的选项，DeepInfra 适配器依据条目命名参考图，`GET /v1/models` 列出完整的逐模型词汇。

## 后果

提供给选择器的图像模型目录（`imageModelCatalog`）与选择器在 Web 组合中现在恰好包含两个 Aeven 模型。图像模型从未进入聊天模型选择器或 `/models`：网关把它们标记为 `image` 而非 `chat`，而聊天目录按 `chat` 过滤。

`avn-media-deepinfra`、`avn-media-openrouter` 与 `avn-media-pi-ai` 仍是组合可以挂载的包，但没有任何内置组合挂载它们。

内置目录是网关的镜像：网关新增的模型在本列表随包发布之前不会被提供。网关现在发布了未来扩充步骤要读取的词汇。

## 验证

`avn-media`、`avn-media-aeven` 与 `avn-tool-media` 的单元覆盖率为 100%：内置目录及其顺序、请求转换与每一种提前拒绝、网关错误映射、按用户的凭据解析及其回退、通过文件系统替身读取参考图，以及经由执行器的 `choices` 限制。网关的单元测试断言了目录中每个模型的选项、列表、规范化器的拒绝，以及两种参考图字段命名。

## 考虑过的替代方案

**从 `GET /v1/models` 获取图像目录。** 否决：该列表回答的是某个账号的权益，因此账号缺少的模型会从菜单中消失，而不是说明该账号需要什么。

**保留厂商 provider 的挂载，只裁剪 `choices`。** 否决：`imageModelCatalog` 提供的 seam 目录仍会列出每个厂商模型，而调用中指明的模型仍能触达它们。

**依据 seam 层的选项描述符在工具中校验每个选项。** 暂时否决：provider 拥有自己的目录并拒绝其模型没有的选项，其余由网关拒绝；seam 描述符没有第二个消费者。
