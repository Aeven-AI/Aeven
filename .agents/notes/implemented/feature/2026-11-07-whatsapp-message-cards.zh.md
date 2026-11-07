# Agent Note：WhatsApp 消息卡片

Status: implemented

[English](2026-11-07-whatsapp-message-cards.md) | 中文

## 问题

让 Aeven 查看 WhatsApp 时，界面只显示一个通用工具行，里面是守护进程的文本列表，回答也只能用文字描述媒体：语音消息、照片、GIF 或视频从未到达读者。收到的媒体也留在守护进程的文件夹里，不在对话中。

## 决定

`list_messages` 或 `get_message_context` 调用在折叠的过程组之外按聊天各绘制一张卡片：按日期排列的聊天气泡、照片和贴纸、静音循环的 GIF、进入视野时静音自动播放的视频、可下载的文档，以及带播放按钮和可跳转波形的语音消息。

- **数据。** 守护进程在不变的文本旁返回 `structuredContent.messages`（按时间从旧到新、去重、已解析发送者名称）（[`message_cards.go`](../../../../native/whatsapp-mcp/source/internal/mcp/message_cards.go)）。MCP 桥通过 `presentationMeta` 把任何 `structuredContent` 记录为持久化 `tool/result` 的 meta（[`tools.ts`](../../../../packages/mcp/mcp-client/src/tools.ts)），因此卡片可从会话日志重放，而模型仍只读取文本。
- **媒体。** 守护进程受令牌保护的 `GET /media` 提供一条消息的解密字节，并把语音消息重新编码为 AAC，因为 18.4 之前的 Safari 无法播放 Ogg Opus（[`media_http.go`](../../../../native/whatsapp-mcp/source/internal/mcp/media_http.go)）。`accountIntegrations.whatsAppMessageMedia` 根据调用的工具名确定账户，只响应当前用户自己的号码，并返回 base64，因为 Typert Remote 结果只携带 JSON。
- **视图。** 连接器工具名带有账户前缀，因此 `ToolCallTree` 以 `mcp__<provider>__<tool>` 查找视图（[`tool-view-key.ts`](../../../../packages/client/ui-tool/src/client/tool/tool-view-key.ts)）。Connectors 插件注册卡片和 `connector-cards` 轮次索引，Chat 将其并入保持可见的生成图片调用 id（[`connector-cards.ts`](../../../../packages/client/ui-settings-integrations/src/client/connector-cards.ts)）。浏览器从解码后的录音计算波形。

## 考虑过的替代方案

**面向模型的卡片工具**（模型调用 `show_messages`）被否决：它让每次回答的调用数翻倍，并且模型可能遗漏读者期待的媒体。

**由宿主 HTTP 路由流式传输媒体** 可以为长视频支持范围请求，但目前没有宿主插件注册 HTTP 路由；带大小上限（`whatsappMediaMaxBytes`）的 Remote 已覆盖语音消息、照片、GIF 和普通视频。

## 影响

所有返回 `structuredContent` 的 MCP 工具现在都会把它持久化到 `tool/result` 的 meta 中，会话日志因此增加相应的载荷。超过 `whatsappMediaMaxBytes` 的视频显示为不可用。桌面端组合了相同的插件，因此只要关联了 WhatsApp 号码，卡片就能工作。
