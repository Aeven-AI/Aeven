---
description: "Imagine 界面：在 /i/<id> 以其页面取代对话占据中间栏，以及 /image-model 选择器。"
kind: "package-reference"
---
# @aeven/client-ui-imagine

[English](README.md) | 中文

## 概要

Imagine 是位于 `/i/<id>` 的独立页面，与对话 Session 相互分离。插件在布局的界面路由（`ctx.layout.surfaces`）上声明 `/i` 路径根，并把页面贡献到 `surface` slot，因此地址位于 `/i` 之下时，中间栏显示 Imagine 而非对话，对话的详情栏与右侧边栏保持关闭。裸 `/i`，或 id 不是 UUID 的地址，会被原地改写为新的 `/i/<uuid>`。该 id 不指向任何 Session。

起始页就是对话的新会话界面：产品名与读者的问候语（对话的 `HeroShell`），其下是一张沿用对话首屏输入框几何尺寸的输入卡片。卡片会保留读者输入的内容；在 Imagine 能够生成之前，添加与发送控件保持禁用。

同一插件还挂载对话输入框中的 `/image-model` 选择器：一份可搜索的部署图像模型列表，已存储的选择标记为当前项，选中后会提交 `/image-model <provider>/<model>`，也就是存储该选择的那一行。列表行由部署配置的 `choices`，加上 `listedProviders` 中 Provider 当前提供的模型组成，分别读取本客户端的 `media` 设置作用域与 Seam 自身的目录。在 Imagine 自身还没有模型控件之前，这是选择图像模型的入口；该选择属于部署的图像生成设置，因此与 `generate_image` 共用，而非本页面私有。

对话中的图片生成由 `ImageToolView` 在工具调用位置渲染，注册的工具为 `generate_image`、`codex_image_generate`、`codex_image_edit` 和 `grok_imagine_image`。运行视图显示提示词、加载标记和已用秒数；成功使用共享附件图库，失败在同一预留框中保留错误。单张图片在生成、附件加载和完成阶段均预留 240×240 px。显式指定较多图片时预留额外行。这些调用在过程折叠时仍可见，包括嵌套代码派发；不新增进度事件或独立图片存储。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

无，因为 Imagine 页面及其选择器上的任何内容都不会进入模型请求：选择器只存储一项设置选择，每次生成仍交由 `generate_image` 处理。

#### KV Cache effect

无；该页面不发送请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **尚无生成能力** —— 输入卡片可以输入文字，但不会发送任何内容；添加与发送控件处于禁用状态。
- **选择器的列表行重述了主机侧的可选列表** —— 本插件会把设置中的 choices 与列出 Provider 的目录合并，因为该目录会随订阅的登录状态变化；主机在收到提交的行时会重新解析同样的两个来源，并拒绝列表之外的模型，因此主机不再提供的列表行会以该命令的错误形式呈现。
- **输入卡片重述了对话卡片的 CSS** —— 其取值沿用 ui-conversation 的首屏输入框，在两个输入框共用同一组件之前，那边的改动需要同步到这里。
- **没有导航入口** —— 侧边栏的 Imagine 行尚未链接到这里；只能通过地址访问该页面。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
