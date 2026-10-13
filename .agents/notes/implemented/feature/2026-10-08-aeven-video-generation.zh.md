# Agent Note：在工具调用处生成 Aeven 视频

Status: implemented

[English](2026-10-08-aeven-video-generation.md) | 中文

## 问题

Aeven 网关在 `POST /v1/videos` 提供 `Aeven-1.0-Video-Pro`，但任何 Aeven 会话都无法使用它：`media-aeven` 只注册了图片 provider，`tool-media` 只发布了 `generate_image`，也没有任何客户端视图能播放成片。

## 决定

`media-aeven` 在图片 provider 旁注册一个视频 provider。它以 `Prefer: respond-async` 启动网关任务，读取 `GET /v1/videos/{id}`，并把 `in_progress`、`completed`、`failed` 映射为 seam 的 `running`、`succeeded`、`failed`。`fetchVideo` 下载已完成任务结果中给出的 HTTPS URL，受 `maxVideoBytes` 限制。本地参考图成为首帧与尾帧，因为网关的其他参考字段只接受 HTTPS 或 `asset://` URL。

`tool-media` 在设置了 `video` 配置时发布 `generate_video`。一次调用启动任务、等待其完成，并用 `ctx.attachments.saveFile` 存储成片；结果以文件块引用它。模型把该块读作 `<attached_file>` 元素，而由于会话日志引用了它，`/api/attachment-file` 会把它提供给客户端。图片工具的模型选择改为由两种类型共用的 `installSelection`，因此 `/video-model`、其选择器与 `media-video` 设置文档的行为与 `/image-model` 和 `media` 相同。随附预设以 `confirmModel: false` 将 Video Pro 设为默认。

Imagine 为 `generate_video` 注册 `VideoToolView`。任务运行期间，调用显示与图片卡片相同的框及其加载标记，随后在同一框中显示由 `VideoPlayer` 自带控件承载的成片，不使用灯箱。控件属于产品自身而非浏览器：承载 lucide 字形的白色播放圆盘、已播与总时长读数、进度条、带独立音量滑杆的白色音量圆盘、由竖排省略号圆盘打开、卡片与单元格沿用作曲器弹层配方的保存弹层，以及白色全屏圆盘，因此控件与客户端其余部分一致，而不是浏览器的外观。所有外观均由成片自身的事件驱动，全屏取在播放器元素上，因此控件在全屏界面上仍然随成片；播放时指针离开一段时间后控件栏自动收起。`/api/attachment-file` 以 `206` 应答单个字节范围，使播放器可以拖动进度。

## 影响

视频调用在整个渲染期间（最长 `maxWaitMs`）保持打开，因此在此期间模型不会在该轮做其他工作。成片与任何上传一样，是归会话日志所有的持久文件附件。这取代了[在工具调用处生成图片的备注](2026-10-02-generated-images-at-tool-calls.zh.md)中“视频生成仍保持独立”的说法：调用只在成片字节存储之后才完成。

## 验证

应用户要求，验证仅限 TypeScript 检查与构建：未运行测试套件，也未进行真实的生成调用。

## 考虑过的替代方案

像 Grok Imagine 视频工具那样分为启动工具与状态工具，会让模型自行轮询，转录中也没有一个可以显示成片的单一调用。像 `subscription-auth` 那样把成片存入带限时路由的私有媒体存储，会在附件存储之外增加第二个存储所有者，成片也不再由会话日志引用。要求网关同步应答，会把一次付费渲染绑定在一条 HTTP 连接上。
