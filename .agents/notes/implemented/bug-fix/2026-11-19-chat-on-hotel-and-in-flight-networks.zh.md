# Agent Note：酒店和机上 Wi-Fi 中聊天轮次失败

Status: implemented

[English](2026-11-19-chat-on-hotel-and-in-flight-networks.md) | 中文

## 问题

使用酒店 Wi-Fi 和配备 Starlink 的航班的用户报告，轮次一直停在“Ævening”，最后出现“Aeven couldn't be reached”。在双向只放行 TCP 80 和 443 的防火墙后面，桌面端聊天正常，因此端口封锁不是原因。在 300 毫秒带抖动的延迟和 2% 丢包下，一个轮次的每次尝试都在约 45 秒后以 `TRANSPORT` 失败，五次尝试中的第三次在 2 分 29 秒后成功。

三个测得的事实解释了这一点。Cloudflare 在联系源站之前缓冲请求体，并在上传静默 15 秒时重置连接；14 秒的暂停通过，16 秒的暂停在 15.1 秒时被重置。每个轮次都上传整段对话：新对话 132 KB，一个 704 条消息的对话 1.82 MB，其中 849 KB 是 25 张内联工具截图。每个带图片的轮次都会先向 `POST /api/v1/files` 上传一张图片，网关以 415 回应，然后才内联发送图片。重试会把完整上传重复发进同一条链路。此外，离线数天后重新上线的设备在同一链路上下载了 119 MB 的账户同步积压，而会话日志只记录 `Aeven API request to … failed`，因此客户端的日志无法说明是哪一步出错。

报告背后的客户端在 2026-11-18 05:00 UTC 之后没有任何请求到达 pink，包括每小时一次的 `refresh-token` 调用，因此那次航班上的失败发生在源站之前，本次没有复现。

## 决定

- `llm-aeven` 用 gzip 压缩聊天请求体（`requestCompression`，默认 `gzip`）；网关的 `express.json` 解析器会解压它。新对话的请求从 132 KB 降到约 39 KB。
- `llm-aeven` 从第一次尝试起就内联发送图片（`imageTransport: 'inline'`），因此带图片的轮次不再把一次上传花在网关没有的 Files API 上。`llm-deepseek` 对官方 API 保持 `files-api` 和未压缩的请求体。
- `llm-aeven` 每个请求最多保留 10 张图片和 1.5 MiB 内联图片数据，按每次 5 张图片或 768 KiB 移出最旧的图片。被移出的图片保留其占位符路径。
- `TRANSPORT` 失败的消息末尾附上 fetch 原因链中最深一层带 code 的错误（`transportFailureMessage`），例如 `(ECONNRESET: read ECONNRESET)`。
- 同步 relay 连接每隔 `heartbeatMs`（30 秒）发送一次 ping，静默一个完整间隔后重新连接。Host 上有任何 agent 运行时，每个追赶页最多等待 `catchUpYieldMs`（15 秒）。
- 桌面外壳以 `--network-family-autoselection-attempt-timeout=1000` 启动 Host，因此比 Node 默认 250 毫秒更慢的握手不会被放弃而改试下一个解析出的地址。

## 考虑过的替代方案

- **把推理请求发到不经 Cloudflare 代理的主机名。** 暂不采用：它去掉了 15 秒限制，也去掉了 Cloudflare 的边缘节点，而更小的上传已经缩短了暴露时间。
- **把每张图片向网关只上传一次并通过引用使用。** 推迟：它让模型看得到每张图片，但需要 `servers/node` 中的网关存储。
- **在整个轮次期间暂停追赶。** 不采用：一个 computer-use 轮次会运行数分钟，而实时帧要等追赶完成订阅后才到达。

## 影响

带有许多截图的长对话中，模型看到的截图更少；模型通过占位符路径读取更早的截图。代理拒绝 `Content-Encoding: gzip` 的网关部署必须设置 `requestCompression: none`。如果客户端下一次失败日志写的是连接超时或 TLS 错误而不是重置，原因就在设备与 Cloudflare 之间，下一步应读取 Cloudflare 针对该航班地址的安全事件。
