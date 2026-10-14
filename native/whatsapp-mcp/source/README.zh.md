# WhatsApp MCP Server

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/github/license/Sealjay/mcp-whatsapp)](LICENSE)
[![CI](https://github.com/Sealjay/mcp-whatsapp/actions/workflows/ci.yml/badge.svg)](https://github.com/Sealjay/mcp-whatsapp/actions/workflows/ci.yml)
[![Go Report Card](https://goreportcard.com/badge/github.com/Sealjay/mcp-whatsapp)](https://goreportcard.com/report/github.com/Sealjay/mcp-whatsapp)
[![Go 1.25+](https://img.shields.io/badge/Go-1.25%2B-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![MCP](https://img.shields.io/badge/MCP-protocol-6366f1)](https://modelcontextprotocol.io/)
[![42 tools](https://img.shields.io/badge/tools-42-blue)]()
[![whatsmeow](https://img.shields.io/badge/whatsmeow-multidevice-25D366?logo=whatsapp&logoColor=white)](https://github.com/tulir/whatsmeow)
[![Sealjay/mcp-whatsapp MCP server](https://glama.ai/mcp/servers/Sealjay/mcp-whatsapp/badges/score.svg?)](https://glama.ai/mcp/servers/Sealjay/mcp-whatsapp)
[![GitHub issues](https://img.shields.io/github/issues/Sealjay/mcp-whatsapp)](https://github.com/Sealjay/mcp-whatsapp/issues)

一个单二进制 Go [MCP](https://modelcontextprotocol.io/) 服务器，包装 [whatsmeow](https://github.com/tulir/whatsmeow)，把个人 WhatsApp 账户暴露给 LLM。`whatsapp-mcp serve` 作为轻量 HTTP 守护进程运行在 `127.0.0.1:8765`；MCP 客户端（Claude Desktop、Cursor、Claude Code 等）通过 HTTP 连接它——无需拉起进程，无需摆弄 stdin/stdout。消息缓存在本地 SQLite 中，只有当 agent 调用工具时才会送到模型。

> **无关联声明。** 这是一个独立的开源项目。它与 Meta Platforms, Inc.、WhatsApp 或 [whatsmeow](https://github.com/tulir/whatsmeow) 无关联、未获其背书，也不存在其他关系。“WhatsApp” 是 Meta Platforms, Inc. 的商标，此处以指名方式使用，用于描述互操作性。

本项目始于 [lharries/whatsapp-mcp](https://github.com/lharries/whatsapp-mcp) 的一个分支，此后被重写为一个 Go 二进制。它在原版之上增加了：

- **LID 解析** —— 把 `@lid` JID 归一化为真实手机号，以便准确匹配联系人。
- **已发送消息存储** —— 出站消息在本地持久化，使对话历史保持完整。
- **阅后即焚计时器** —— 出站消息自动继承群聊的临时消息计时器。
- **定向历史同步** —— 通过 `request_sync` 工具按聊天按需回填。
- **扩展的工具面** —— 42 个工具（见下文）：表情回应、回复、编辑、撤回、标记已读、输入状态、is-on-whatsapp、完整的群管理、黑名单、投票（创建 + 投票 + 计票）、联系人名片、阅后即焚标志、在线状态、隐私设置，以及资料的 “About” 文本。
- **单实例强制** —— 在 `store/.lock` 上加 `flock(2)`，防止两个 `serve` 进程在同一批 SQLite 文件上竞争。

## 安装

### 前置条件

- Go 1.25+（仅构建时需要；运行时只需编译好的二进制）。
- 一个会讲 HTTP 的 MCP 客户端（Claude Desktop、Cursor、Claude Code 等）。
- FFmpeg（_可选_）—— 仅在 `send_audio_message` 的输入不是 `.ogg` Opus 时需要。没有它就用 `send_file` 发送原始音频。
- **Windows：** 必须启用 CGO —— 见 [docs/windows.md](docs/windows.md)。

### 安装

```bash
git clone https://github.com/Sealjay/mcp-whatsapp.git
cd mcp-whatsapp
make build    # writes ./bin/whatsapp-mcp
```

### 配对手机（仅首次运行）

启动守护进程，然后在浏览器中打开配对页面：

```bash
./bin/whatsapp-mcp serve          # starts on 127.0.0.1:8765
open http://127.0.0.1:8765/pair   # macOS; or visit the URL manually
```

用手机上的 WhatsApp 扫描二维码（*Settings → Linked Devices → Link a Device*）。配对结果持久化到 `./store/whatsapp.db`。当 WhatsApp 使该会话失效时（大约每 20 天），再次访问 `/pair` 并重新扫描。

**替代方式（无界面 / CI）：** `./bin/whatsapp-mcp login` 会在终端渲染二维码。没有浏览器时使用它。

### 连接你的 MCP 客户端

`whatsapp-mcp serve` 是运行在 `127.0.0.1:8765`（或 `$WHATSAPP_MCP_ADDR`）上的 HTTP 守护进程。MCP 客户端通过 HTTP 连接它：

Claude Desktop 的 `claude_desktop_config.json` 不像 Claude Code 与 Cursor 那样支持裸 `url`/`type: http` 条目——它只用 `command`/`args` 拉起 stdio 服务器。改用 [`mcp-remote`](https://www.npmjs.com/package/mcp-remote) 桥接：

```jsonc
// Claude Desktop — ~/Library/Application Support/Claude/claude_desktop_config.json
{
  "mcpServers": {
    "whatsapp": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "http://127.0.0.1:8765/mcp"]
    }
  }
}
```

```jsonc
// Claude Code — .claude/mcp.json (project) or ~/.claude/mcp.json (user)
{
  "mcpServers": {
    "whatsapp": { "type": "http", "url": "http://127.0.0.1:8765/mcp" }
  }
}
```

```jsonc
// Cursor — ~/.cursor/mcp.json
{
  "mcpServers": {
    "whatsapp": { "type": "http", "url": "http://127.0.0.1:8765/mcp" }
  }
}
```

重启客户端。WhatsApp 会作为一个可用的集成出现。关闭再重新打开客户端会重新连接到守护进程——不拉起进程，不做每会话握手，也不摆弄 stdin/stdout。

### 发送与接收文件

`WHATSAPP_MCP_MEDIA_ROOT` 是一个允许列表根目录，同时约束文件流动的两个方向：

- **发送** —— `send_file` 与 `send_audio_message` 接受一个指向待发送文件的 `media_path` 参数。该路径必须位于允许的根目录之下。
- **接收** —— `download_media` 把解密后的媒体写入守护进程缓存的 `<store>/<chat_jid>/<hex(message_id)>/<safe_filename>`。以消息 ID 命名的目录防止同名的不同消息共用缓存字节；命中缓存时会用已存储的大小与 SHA-256（若可用）校验。传入可选的 `output_path` 参数还会把文件放到调用方选定的位置，该位置同样必须位于允许的根目录之下。如果 `output_path` 处已有文件，该调用不做任何事。

默认允许的根目录是 `./store/uploads/`（相对于你的 `-store` 目录解析）。首次运行时 `serve` 会自动创建它；把你要发送的文件放进去，如果希望从同一处读取收到的媒体，就把 `output_path` 指向这里。

要允许另一个目录，启动守护进程时设置 `WHATSAPP_MCP_MEDIA_ROOT`（绝对路径）：

```bash
WHATSAPP_MCP_MEDIA_ROOT=/Users/me/whatsapp-shared ./bin/whatsapp-mcp serve
```

或把它加进你的 launchd plist / systemd unit / shell profile，让它在重启后依然生效。

允许的根目录之外的路径会被连一条清晰的错误一起拒绝，以便 Claude 请你移动文件或更新环境变量。根目录内部的符号链接会在检查之前被解析，因此指向根目录之外的符号链接同样被拒绝。不要把机密放进允许的根目录——允许列表界定了该工具能读写什么，但其中的任何东西都在可及范围内。

#### 沙箱客户端（Claude.ai 搭配 Cowork 等）

沙箱化的 MCP 客户端无法读取守护进程的本地缓存。要让它们看到下载的媒体，把 `WHATSAPP_MCP_MEDIA_ROOT` 指向客户端沙箱也能读取的目录（Cowork 工作区挂载、共享卷等），并告诉客户端在每次 `download_media` 调用时把 `output_path` 传入该根目录。一段可直接复制的系统指令：

> When calling the WhatsApp MCP's `download_media`, always pass `output_path` set to a path under your shared workspace. Without it the decrypted file lands only in the daemon's local cache, which is outside your sandbox and unreadable. `output_path` must live under `WHATSAPP_MCP_MEDIA_ROOT` on the daemon side; the basename is yours to pick.

## 架构

一个二进制，七个内部包：

```
cmd/whatsapp-mcp/       login / serve / smoke subcommands
internal/client/        whatsmeow client wrapper (send, download, events, history, features)
internal/daemon/        HTTP server, pairing state machine, /pair endpoint
internal/mcp/           mark3labs/mcp-go server + tool registrations
internal/media/         ogg parsing, waveform synthesis, ffmpeg shell-out
internal/security/      path allowlisting, filename sanitisation, log redaction
internal/store/         SQLite cache, LID resolution, query layer
```

### 进程生命周期

`serve` 作为长期运行的 HTTP 守护进程。MCP 客户端可以自由连接与断开；守护进程保持运行并继续接收 WhatsApp 事件。`store/.lock` 上的 `flock(2)` 防止两个实例在同一存储上竞争（否则 WhatsApp 也会踢掉两个已链接设备连接中的一个）。

代价是：事件**只在 `serve` 运行期间**持久化到 SQLite。如果守护进程停止，WhatsApp 连接就会关闭。下次启动时，whatsmeow 会发出 `events.HistorySync` 事件，把对话回填进 SQLite，但可恢复窗口由 WhatsApp 服务端对多设备客户端的保留策略决定，而不是由本代码库决定。在长于 WhatsApp 保留期的空档中到达的消息无法恢复。对于较短且已知的空档，`request_sync` 工具会按需触发单个聊天的回填。

### 数据存储

所有内容都位于 `./store/` 下（可用 `-store DIR` 覆盖）：

- `store/messages.db` —— 本地聊天/消息缓存，为搜索建立索引。
- `store/whatsapp.db` —— whatsmeow 自己的设备/会话状态。
- `store/.lock` —— 用于单实例 `serve` 的临时建议锁。

### 数据流

1. 客户端通过 HTTP 向 `serve` 发送一个 JSON-RPC `tools/call`。
2. MCP 层把它分派给一个内部处理程序。
3. 处理程序要么查询本地 SQLite 存储，要么直接调用 whatsmeow（发送、下载、表情回应等）。
4. 收到的 WhatsApp 事件在同一进程内的后台 goroutine 中被持久化到存储，因此查询类工具总能看到当前状态。

### 运行守护进程

守护进程被设计为独立于任何 MCP 客户端运行。三种受支持的生命周期模型：

**macOS —— launchd。** 模板位于 `docs/launchd/com.sealjay.whatsapp-mcp.plist`。复制到 `~/Library/LaunchAgents/`，替换 `{{PATH_TO_REPO}}` / `{{STORE_DIR}}` 占位符，然后 `launchctl load`。守护进程从登录起开始运行。

**Linux —— systemd 用户 unit。** 模板位于 `docs/systemd/whatsapp-mcp.service`。复制到 `~/.config/systemd/user/`，替换占位符，然后 `systemctl --user enable --now whatsapp-mcp`。

**Claude Code 的 SessionStart 钩子。** 对于按项目限定生命周期的场景，把 `docs/hooks/setup.sh` 放进你项目的 `.claude/hooks/`，并配置 `settings.json` 调用它。该钩子是幂等的——与 launchd/systemd 同时运行是安全的。

**手动。** 在任意终端中运行 `./bin/whatsapp-mcp serve -addr 127.0.0.1:8765`。Ctrl-C 停止。

**Docker。** 一个多阶段 `Dockerfile` 构建该二进制，并把它连同 ffmpeg 与 CA 证书放在 `debian:bookworm-slim` 上。`ENTRYPOINT` 内置了 `-store /home/app/store`；`CMD` 默认是 `serve`，并可按普通 Docker 命令覆盖（`docker run whatsapp-mcp smoke`、`... login`、`... serve -addr ...`）。持久化 `/home/app/store`，否则每次重启都会丢掉已配对的会话：

```bash
docker build -t whatsapp-mcp --build-arg VERSION=$(git describe --tags --always) .
```

在启动长期运行的守护进程之前先配对一次——`login` 与 `serve` 都会对存储加独占锁，因此对已经在运行的 `serve` 容器通过 `docker exec` 运行 `login` 会以 `another whatsapp-mcp instance is already running` 失败。共享同一卷的一次性容器可避免这一点：此时还没有 `serve` 在运行，因此没有争用，二维码会直接渲染到你的终端，不涉及浏览器或认证头。

```bash
docker run --rm -it -v whatsapp-mcp-store:/home/app/store whatsapp-mcp login
```

然后启动守护进程本身：

```bash
docker run -d --name whatsapp-mcp -v whatsapp-mcp-store:/home/app/store whatsapp-mcp
```

镜像默认在容器内绑定 `127.0.0.1:8765`，与二进制相同——单纯的 `-p 8765:8765` 发布无法到达它，因为 Docker 的端口 NAT 要求进程在非回环接口上接受连接，而该守护进程未经显式选择不接受。要从宿主访问它，请用上文描述的同一组 `-allow-remote` 加 token 覆盖 `CMD`：

```bash
TOKEN=$(openssl rand -hex 32)
echo "$TOKEN"   # your MCP client needs this — it's the bearer token below

docker run -d --name whatsapp-mcp \
  -v whatsapp-mcp-store:/home/app/store \
  -p 127.0.0.1:8765:8765 \
  -e WHATSAPP_MCP_TOKEN="$TOKEN" \
  whatsapp-mcp serve -addr 0.0.0.0:8765 -allow-remote
```

把你的 MCP 客户端指向 `http://127.0.0.1:8765/mcp`，并带上 `Authorization: Bearer $TOKEN` 头——配对已在上面的 `login` 步骤完成，因此无需其他操作。

WhatsApp 大约每 20 天轮换一次已链接设备会话。在 Docker 之外，运行中的守护进程会在这时于 `/pair` 给出新的二维码（见下文）——但在 Docker 中 `/pair` 无法以同样方式访问（上面的基础运行根本不发布端口；远程绑定的那次需要与 `/mcp` 相同的 bearer 头，而普通浏览器访问无法发送它）。改为重复 `login` 步骤重新配对：`docker stop whatsapp-mcp`，重新运行上面那个一次性的 `login` 容器，然后 `docker start whatsapp-mcp`。

镜像有几百 MB，几乎全是 ffmpeg 的 Debian 依赖链（libav*、它顺带拉进来的 X11 渲染库），而不是约 30MB 的 Go 二进制本身。

在 Docker 之外，首次配对改在浏览器中进行：启动守护进程，打开 `http://127.0.0.1:8765/pair`，用手机扫描二维码。不需要终端。WhatsApp 的多设备协议大约每 20 天轮换一次已链接设备会话；届时 `/pair` 页面会自动提供新的二维码——再访问一次并重新配对。`/pair/*` 端点有速率限制（`/pair/reset` 上 15 次 GET/分钟、1 次 POST/分钟）并受 CSRF 保护。

`serve` 的参数与环境变量：

- `-addr host:port`（环境变量 `WHATSAPP_MCP_ADDR`，默认 `127.0.0.1:8765`）。
- `-allow-remote`（显式选择绑定非回环地址；要求 `WHATSAPP_MCP_TOKEN`）。
- `WHATSAPP_MCP_TOKEN` —— 设置 `-allow-remote` 时用于 `/mcp` 与 `/pair/*` 的 bearer token。必填；缺失时 `serve` 退出。
- `WHATSAPP_MCP_MEDIA_ROOT` —— `send_file` / `send_audio_message` 的 `media_path` 与 `download_media` 的 `output_path` 所允许的根目录。
- `WHATSAPP_MCP_DEBUG=1` —— 启用详细日志，并对手机号做部分脱敏（最后 5 位可见）。

## 工具

42 个工具，按用途分组。

### 读取 / 查询

| 工具 | 用途 |
|---|---|
| `search_contacts` | 在缓存的联系人姓名与手机号中做子串搜索 |
| `list_messages` | 查询并过滤消息；返回带上下文窗口的格式化文本 |
| `list_chats` | 列出聊天并带最后一条消息预览；按活跃度或名称排序 |
| `get_chat` | 按 JID 取聊天元数据 |
| `get_message_context` | 某一特定消息前后的窗口 |
| `download_media` | 把已持久化的媒体下载到本地路径 |
| `request_sync` | 请求 WhatsApp 回填某个聊天的历史 |

### 发送

| 工具 | 用途 |
|---|---|
| `send_message` | 向手机号或 JID 发送文本消息 |
| `send_file` | 发送图片/视频/文档/原始音频，可带说明文字；`view_once: bool` 把图片/视频/音频子消息标为阅后即焚（对文档无效） |
| `send_audio_message` | 发送语音消息（不是 `.ogg` Opus 时经 ffmpeg 自动转换）；支持 `view_once: bool` |
| `send_poll` | 发送带问题与 2 个以上选项的投票；`selectable_count` 控制投票者可选的选项数。生成投票解密所需的 32 字节 `MessageSecret` |
| `send_poll_vote` | 对之前见过的投票投票；`options` 必须与选项名称完全一致 |
| `get_poll_results` | 返回我们已缓存的某次投票的计票（含 0 票选项） |
| `send_contact_card` | 发送联系人名片；由 `name` + `phone` 合成 vCard 3.0，或传入原始 `vcard` 跳过合成 |

### 消息操作

| 工具 | 用途 |
|---|---|
| `mark_read` | 把特定的消息 ID 标为已读 |
| `mark_chat_read` | 确认某个聊天中最近收到的消息并清掉未读标记 |
| `send_reaction` | 对一条消息做出表情回应（空 emoji 会清除已有回应） |
| `send_reply` | 引用之前某条消息的文本回复 |
| `edit_message` | 编辑之前发送的消息 |
| `delete_message` | 撤回（为所有人删除）一条消息 |
| `send_typing` | 设置按聊天的正在输入 / 正在录音状态 |

### 群组

| 工具 | 用途 |
|---|---|
| `create_group` | 用名称与初始参与者创建群组 |
| `leave_group` | 退出一个群组 |
| `list_groups` | 列出用户加入的所有群组 |
| `get_group_info` | 完整的群元数据（参与者、设置、邀请配置） |
| `update_group_participants` | 添加 / 移除 / 提升 / 降级参与者（`action: add\|remove\|promote\|demote`） |
| `set_group_name` | 修改群名称 |
| `set_group_topic` | 修改群描述；空字符串会清除它 |
| `set_group_announce` | 切换仅公告模式（只有管理员可以发言） |
| `set_group_locked` | 切换锁定模式（只有管理员可以编辑群元数据） |
| `get_group_invite_link` | 获取邀请链接；`reset: true` 先撤销之前的链接 |
| `join_group_with_link` | 通过 `chat.whatsapp.com` URL 或裸邀请码加入群组 |

### 黑名单

| 工具 | 用途 |
|---|---|
| `get_blocklist` | 返回当前黑名单（JID，通常是 `@lid`，以及已知的手机号） |
| `block_contact` | 按手机号或 JID 拉黑联系人 |
| `unblock_contact` | 解除对联系人的拉黑 |

### 隐私 / 在线状态 / 状态

| 工具 | 用途 |
|---|---|
| `send_presence` | 设置自己的可用性（`available` 或 `unavailable`）——与按聊天的 `send_typing` 不同 |
| `get_privacy_settings` | 以 JSON 返回当前隐私设置 |
| `set_privacy_setting` | 通过 `name` + `value` 修改一项隐私设置（严格的枚举校验；无效组合会被拒绝） |
| `set_status_message` | 更新资料的 “About” 文本；空字符串会清除它 |

### 管理

| 工具 | 用途 |
|---|---|
| `is_on_whatsapp` | 批量检查哪些手机号已在 WhatsApp 注册 |
| `get_status` | 报告桥接是否已连接，以及它以哪个账户配对 |
| `pairing_status` | 以结构化的 `setup_state` 信封（`ready` / `awaiting_qr` + `qr_payload` / `error`）报告设备配对状态，供会展示链接二维码的自动化监管程序使用 |

### 延期

有意暂不暴露：

- **`subscribe_presence`** —— 没有用于在线状态事件的持久化层，跳过以免留下一个悬空的工具。
- **资料照片设置器** —— 上游 whatsmeow 没有暴露用户级设置器。
- **审批模式参与者、社区、newsletter** —— 使用面很低，已延期。

## 限制

- **提示词注入风险：** 与许多 MCP 服务器一样，这一个也受[致命三元组](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)影响。收到的消息中的提示词注入可能导致私有数据外泄——请据此看待工具面。
- **重新认证：** WhatsApp 可能定期使已链接设备会话失效；届时重新运行 `./bin/whatsapp-mcp login`。
- **`serve` 未运行时的消息空档：** 事件只在二进制存活期间流入 SQLite。离线窗口期间发送的消息，只有在 WhatsApp 的多设备保留策略仍持有它们时才在下次重连时被恢复；更长的空档请按聊天使用 `request_sync`，或接受丢失。
- **每个存储只能有一个实例：** 只有一个 `whatsapp-mcp serve` 能持有存储锁。并行的 MCP 客户端必须指向不同的 `-store` 目录（因而也是不同的已配对会话）。
- **Windows：** 需要 CGO 与 C 编译器——见 [docs/windows.md](docs/windows.md)。
- **上游边界：** 消息的抓取/发送受 [whatsmeow](https://github.com/tulir/whatsmeow) 针对 WhatsApp web 多设备 API 所支持的范围约束。
- **日志脱敏是混淆，不是匿名化。** 对你的联系人有部分了解的人，可以借助最后 5 位可见数字做关联。`./store/uploads/` 内的符号链接在路径检查之前被解析，因此它们无法逃逸，但根目录本身是一条信任边界——只把你要发送的文件放进去。

## 开发

```bash
make test          # unit tests
make test-race     # with -race
make vet           # go vet
make e2e           # build + JSON-RPC smoke over HTTP (requires -tags=e2e)
make smoke         # boot-test the server without connecting to WhatsApp
```

### 升级 whatsmeow

每周 CI 会运行一次上游升级探测。手动执行：

```bash
make upgrade-check
```

它会升级 `go.mau.fi/whatsmeow@main`、重新整理依赖、构建并测试。如果通过，就提交 `go.mod` / `go.sum` 的改动。

CI 中的 `scripts/mdtest-parity.sh` 会在上游移除或重命名我们调用的任何 whatsmeow 方法时让构建尽早失败——它是 API 漂移的预警。

## 故障排查

- **`serve` 上出现 `connect failed …`** —— 守护进程尚未配对。在浏览器中打开 `http://127.0.0.1:8765/pair` 并扫描二维码。或者在终端中运行 `./bin/whatsapp-mcp login`。
- **`another whatsapp-mcp instance is already running`** —— 只有一个 `serve` 能持有存储锁。检查是否有游离进程（`ps aux | grep whatsapp-mcp`），或是否有另一个 MCP 客户端指向同一个 `-store` 目录。
- **二维码不显示** —— 终端无法渲染半块 Unicode 字符。试试 iTerm2、Windows Terminal 或类似终端。
- **达到设备上限** —— WhatsApp 对已链接设备有上限。在手机上的 *Settings → Linked Devices* 中移除一个。
- **消息加载不出来** —— 首次认证后，历史回填可能需要几分钟。用 `request_sync` 针对特定聊天。
- **WhatsApp 不同步** —— 删除两个数据库文件（`store/messages.db` 与 `store/whatsapp.db`），然后重新运行 `login`。
- **`ffmpeg not found`** —— `send_audio_message` 需要 `PATH` 中的 ffmpeg 来转换非 Opus 音频。原始音频请改用 `send_file`。

### 调试日志

默认情况下，stderr 日志中的 JID 被脱敏为 `…<last-4-chars-of-user-part>`，消息正文被概括为 `[<length>B: text|url|command]`。媒体 CDN URL 被折叠为 `<scheme>://<host>/…`。要在主动调试时看到消息内容：

- 作为参数：`./bin/whatsapp-mcp -debug serve`
- 作为 MCP 客户端配置中的环境变量：

  ```json
  "env": { "WHATSAPP_MCP_DEBUG": "1" }
  ```

即使开启调试模式，正文与 JID 中形如手机号的数字序列仍被部分遮蔽——只有最后 5 位可见（例如 `+15551234567` → `****34567`）。这意味着调试日志可以安全地放进缺陷报告，而不会泄露完整手机号。

**诚实说明。** 部分脱敏方案是为了方便读日志的人而做的混淆，不是匿名化。对你的联系人有独立了解的人，仍能把最后 5 位与某个具体手机号关联起来。请把脱敏后的日志当作“大概可以粘进 GitHub issue”，而不是“已匿名化”。

关于 Claude Desktop 集成问题，见 [MCP 文档](https://modelcontextprotocol.io/quickstart/server#claude-for-desktop-integration-issues)。

## 贡献

欢迎通过 pull request 贡献。见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可证

MIT 许可证 —— 见 [LICENSE](LICENSE)。
