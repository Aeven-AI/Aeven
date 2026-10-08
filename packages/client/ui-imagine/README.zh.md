---
description: "Imagine 界面：在 /i/<id> 以其页面取代对话占据中间栏、对话中的图片与视频视图，以及 /image-model 与 /video-model 选择器。"
kind: "package-reference"
---
# @aeven/client-ui-imagine

[English](README.md) | 中文

## 概要

Imagine 是位于 `/i/<id>` 的独立页面，与对话 Session 相互分离。插件在布局的界面路由（`ctx.layout.surfaces`）上声明 `/i` 路径根，并把页面贡献到 `surface` slot，因此地址位于 `/i` 之下时，中间栏显示 Imagine 而非对话，对话的详情栏与右侧边栏保持关闭。裸 `/i`，或 id 不是 UUID 的地址，会被原地改写为新的 `/i/<uuid>`。该 id 不指向任何 Session。

起始页就是对话的新会话界面：产品名与读者的问候语（对话的 `HeroShell`），其下是一张沿用对话首屏输入框几何尺寸的输入卡片。卡片会保留读者输入的内容；在 Imagine 能够生成之前，添加与发送控件保持禁用。

同一插件还挂载对话输入框中的 `/image-model` 选择器：一份可搜索的部署图像模型列表，已存储的选择标记为当前项，选中后会提交 `/image-model <provider>/<model>`，也就是存储该选择的那一行。列表行由部署配置的 `choices`，加上 `listedProviders` 中 Provider 当前提供的模型组成，分别读取本客户端的 `media` 设置作用域与 Seam 自身的目录。在 Imagine 自身还没有模型控件之前，这是选择图像模型的入口；该选择属于部署的图像生成设置，因此与 `generate_image` 共用，而非本页面私有。`/video-model` 在 `media-video` 设置作用域上提供同样的选择器；其列表行只有该文档的 `choices`，因为没有列出的 Provider 提供视频模型。

对话中的图片生成由 `ImageToolView` 在工具调用位置渲染，注册的工具为 `generate_image`、`codex_image_generate`、`codex_image_edit` 和 `grok_imagine_image`。每个图片框左下角有一个圆形提示词控件：悬停时自述名称，点击后在与连接器技能弹窗相同的对话框中打开提示词，标题行带一键复制。调用运行期间该控件位于加载标记之上，失败框中同样保留。成功使用共享附件图库，失败在同一预留框中保留错误。单张图片在生成、附件加载和完成阶段均预留 240×240 px。显式指定较多图片时预留额外行。这些调用在过程折叠时仍可见，包括嵌套代码派发；不新增进度事件或独立图片存储。`VideoToolView` 注册于 `generate_video`，渲染同样的框：任务运行期间是按请求宽高比显示的框上的加载标记，随后是由 `VideoPlayer` 自带播放控件承载的内联成片，从 `/api/attachment-file` 读取结果所引用的成片，元数据加载后框采用成片自身的形状。该控件栏属于产品自身而非浏览器：白色平面圆盘承载 lucide 的 `play` 字形、已播与总时长读数、进度条、`volume-2`/`volume-x` 圆盘及其音量滑杆、由竖排省略号圆盘打开的保存弹层（其 `download` 行按成片自身文件名下载，卡片与单元格沿用作曲器的弹层配方），以及全屏用的 `maximize-2`/`minimize-2` 圆盘。每个控件都是承载产品黑色字形的白色表面，全部外观由成片自身的事件驱动，全屏取在播放器元素上，因此控件始终随成片；播放中的成片在指针离开一段时间后收起控件栏，指针回到成片或暂停时立即恢复。其提示词控件位于左上角，避开控件栏。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

无，因为 Imagine 页面及其选择器上的任何内容都不会进入模型请求：选择器只存储一项设置选择，每次生成仍交由 `generate_image` 或 `generate_video` 处理。

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
