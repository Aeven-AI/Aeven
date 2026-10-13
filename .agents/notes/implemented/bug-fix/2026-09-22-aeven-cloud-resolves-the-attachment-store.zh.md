# Agent Note: Aeven 路由解析附件存储

Status: implemented

[English](2026-09-22-aeven-cloud-resolves-the-attachment-store.md) | 中文

## Problem

部署自有路由上每一个带图的回合都以 `UNSUPPORTED_CONTENT` 失败：*“DeepSeek image conversion requires the durable attachment service.”* 暴露它的那个回合在一步之前刚调用过 `read_image`，而那一次调用是**成功**的——该工具只在挂载了持久存储时才注册，它已把图片存好并返回了内容寻址的引用。拒绝来自紧随其后组装的模型请求。

`@aeven/llm-aeven` 通过复用 `DeepSeekAdapter` 来注册 Aeven 网关路由，并传给它三个钩子。它传了 `options`、`resolveApiKey`、`resolveUserId` 和 `prepareExtensions`——但没有传 `resolveAttachments`，也没有传只读访问桥。adapter 的这个选项是可选的，而该插件的模块注释把这一省略描述为有意为之：*“The DeepSeek-only paths (file upload, image offload) stay unconfigured here, because the gateway accepts images inline as `image_url` parts and has no files API to upload them to.”*

那句话把两条不同的路径混为一谈。Files API 在网关上确实不存在，因而保持未配置。而附件解析才是把持久引用变成字节的那一步——没有它就没有任何东西可以内联发送，因此注释所描述的内联形式根本无法到达。任何带有图片的会话都在序列化之前就撞上拒绝：粘贴的截图与 `read_image` 的结果一样。

`@aeven/llm-deepseek` 与 `@aeven/llm-pi-ai` 都传了 `resolveAttachments: () => ctx.get('attachments')` 以及同一个访问桥，subscription-auth 的 adapter 则在它们自己的调用点拿到该值，因此这条路由是唯一漏掉它的。

## Decision

Aeven 路由现在解析与 DeepSeek 路由相同的两个钩子：`resolveAttachments` 按请求读取 `ctx.get('attachments')`——即基础组合挂载在本行旁边的那个存储——而 `resolveImageAccess` 通过与兄弟路由完全一致的方式，借助 `ctx.get('fs')?.processPathFromHostPath` 把一个引用桥接进当前工具执行世界。

Files API 保持未配置，并且现在被明确表述为唯一有意省略的一项：adapter 会先尝试 file 表示，在网关返回 404 时回退到 base64，于是图片以网关接受的形式抵达网关。该回退是 adapter 对“无法完成的上传”既有的行为，不是这条路由新加的。

回归被端到端钉住，且针对真实的本地存储与一个拒绝 `/files` 的网关替身：图片以 inline data URL 进入 chat body，在挂载文件系统时其 handle 指明规范化副本的路径，而不含图片的请求从不进入图片路径。去掉这两个钩子会逐字复现生产环境的拒绝。

## Alternatives considered

接一个 Files API 被否决：网关没有，为了保住 file-id 表示而凭空造一个，只会让部署以另一种方式因同样的原因拒绝图片。让 adapter 把缺失的存储当作“只发文本”同样被否决，因为那样这个回合会若无其事地回答一个模型看不见的图片的问题，这比它所取代的拒绝更糟，也不是 `Aeven-1.0-Flash` 所声明的能力。把 DeepSeek 路由的 adapter 构造抽成共享工厂被考虑后搁置：两条路由在授权、默认值和扩展字段上都不同，而真正需要共享的传输部分已经共享了。

## Consequences

- 图片在 `aeven-cloud` 上可用：`read_image` 的结果与附加的截图以内联形式抵达模型，代价是每个带图请求先有一次被拒绝的 Files API 尝试。
- `Aeven-1.0-Flash` 声明了 `image` 输入模态，而此前这是这条路由兑现不了的承诺；`Aeven-1.0-Pro` 仍按 adapter 自己的措辞拒绝图片。
- `@aeven/attachment` 与 `@aeven/fs` 被声明为 `@aeven/llm-aeven` 的 peer，与 `@aeven/llm-deepseek` 一致，lockfile 记录了两条链接。
