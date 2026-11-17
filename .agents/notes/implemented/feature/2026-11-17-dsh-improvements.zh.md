# Agent Note：从 dsh-v0.2.1-rc.3 到 dsh-v0.2.2-rc.3 的 DSH 改进，按 Aeven 适配

Status: implemented

[English](2026-11-17-dsh-improvements.md) | 中文

## Problem

DeepSeek Harness 的 dsh-v0.2.1-rc.3 至 dsh-v0.2.2-rc.3 版本也为 Aeven 共享的包带来了性能与功能改进。Aeven 在 chat.aeven.io 与手机上通过一条未压缩的 WebSocket 传输每个聊天，每次显示文件图片都重新下载，每个结束的后台任务都要花一次模型调用读取其输出，并且只读的搜索与列表工具逐个运行。Aeven 的账户同步与多设备输入已与 DSH 分化，因此每项改动都必须让在设备与版本之间移动的会话、提示与附件继续正常工作。

## Decision

- **WebSocket 压缩**（`avn-api-gateway`）：Remote 流 mux 默认协商 `permessage-deflate`（zlib 1 级），可配置为 `websocketCompression: 'none' | 'deflate'`，并且只压缩 JSON 文本达到 1,024 个字符的帧。不提供该扩展的对端得到与现在相同的未压缩连接。DSH 还把接收上限降为 `max(streamInboxBytes, 1 MiB)`；Aeven 保留 `ws` 的默认上限（`ws` 同样将其用于解压后的大小），因为 Aeven 的 mux 没有上行收件箱，更低的上限可能关闭如今承载大负载的连接。
- **文件重新验证**（`avn-api-session-controller`）：`/api/file` 响应以文件版本作为 `ETag`，并带 `Cache-Control: private, no-cache`；匹配的 `If-None-Match` 经一次 `stat` 后得到空的 304。DSH 改为重定向到按版本缓存一年的 `immutable` URL；这需要桌面端 `avn-app:` 协议处理器跟随重定向，并会让已退出登录的浏览器在 12 小时账号 cookie 过期后仍能读取字节，因此 Aeven 每次加载都经身份验证重新验证。
- **完成通知中的任务输出**（`avn-tool-jobs`）：当完整通知不超过 `inlineOutputBytes`（默认 2048）和生产方的 `outputLimitBytes` 时，完成通知携带任务未读的输出；否则仍指向 `job_output`。通知以多行标签的第一行命名任务。通知仍待投递时调用 `job_output` 会返回暂存的输出并撤回该通知。Aeven 已在用户发送消息时结束 `job_output` 等待，因此不需要 DSH 的"引导结束等待"改动。
- **可并行的只读工具**：`glob`、`grep`、`job_list`、`cordis_inspect_list`、`cordis_inspect_query` 与 `list_agents` 声明 `isConcurrencySafe`，同一步中的并列调用可以重叠。Aeven 的 `schedule_list` 在日程事务中运行并发出持久变更信号，因此保持独占。
- **Glob 剪枝**（`avn-tool-fs-search`）：以字面目录名开头的模式会添加 ripgrep 仅目录 glob，遍历时跳过无关子树；目录段含通配符、`.`/`..`、VCS 名称或显式 `path` 的模式保持不变。
- **单边图片上限**（`avn-attachment-local`）：`maxImageDimension` 默认 65,535 像素，因此全景图受 6400 万像素上限约束，而不是 8,192 像素的边长。DSH 还把单图字节上限提高到 50 MiB；Aeven 保持 20 MiB，避免经中继的上传以及设备间同步的附件变大。存储的图片保持规范化后不超过 8,192 像素的长边，因此旧版本读取不受影响。
- **请求历史复制**（`avn-llm`）：剥离其他适配器的回放状态时，若没有变化就保留请求与消息的身份，并且每个请求最多解析一次调用方的适配器，而不是每条助手消息解析一次。

## Alternatives considered

**不含 `turnOutline`、`sessionStats` 与 `todos` 的会话列表行**（DSH 92f9e79fac）——当 Host 或另一台设备添加会话时，客户端会把列表行的投影值复制到该会话的本地投影存储；去掉它们会让未打开的会话在打开前保留过期值。未采用；列表保持原样。

**DSH 的输入框、Search API、MCP 管理器等界面功能**——输入框改动需要先做设计决定，Aeven 的网页搜索不使用 DeepSeek Search API，Aeven 的连接器位于服务端。本次未采用。

## Consequences

大型流帧会让 Host 多花少量 CPU 用于 zlib。文件图片每次显示多一次重新验证往返，而不是完整下载。携带输出的任务通知把这些字节放进对话，取代之后的 `job_output` 结果。内联通知投递后再调用 `job_output` 会返回 `(no new output)`。
