# telegram-mcp

[English](README.md) | 中文

*[Русская версия](README.ru.md)*

一个构建在个人 Telegram 账户之上的 MCP 服务器——经 [teleproto](https://github.com/sanyok12345/teleproto)（GramJS 的受维护分支）使用 MTProto；它不是 bot。它让助手读取聊天、发送消息、发起投票，并完成常规 Telegram 客户端能做的大部分事情。

TypeScript，无需构建步骤：Node ≥ 22.18 通过类型剥离直接运行 `.ts`，类型单独用 `npm run typecheck` 检查。

## 安装

从 npm 安装，无需克隆：

```bash
npx @bstuff/telegram-mcp login    # sign in by phone number; the session lands in ~/.telegram-mcp/session (mode 600)
npx @bstuff/telegram-mcp check    # verify the stored session still works
```

或从检出开始：

```bash
npm install
npm run login
npm run check
```

`api_id` / `api_hash` 来自环境变量、检出中的 `.env`，或 `~/.telegram-mcp/.env`（从 `.env.example` 开始——经 npx 安装时就是这里）。若两者都未设置，login 命令会询问它们。

### 获取 api_id / api_hash

它们标识的是*应用*，而不是你的账户——每个 MTProto 客户端都需要自己的一对。大约需要一分钟：

1. 打开 https://my.telegram.org 并用国际格式输入你的手机号（`+971…`）。
2. 确认码**在 Telegram 内**到达，来自官方 Telegram 服务账号的一条消息——不是短信。在页面上输入它。
3. 点击 **API development tools**。
4. 填写表单。只有 *App title* 与 *Short name* 是必填的；*Short name* 必须是 5–32 个字符，字母与数字。URL 留空，平台选 `Desktop`（或 `Other`）——这些都不影响应用如何工作。
5. 按 **Create application**。页面随后显示 `App api_id`（一个数字）与 `App api_hash`（32 个十六进制字符）。
6. 把两者放进 `.env`：

   ```bash
   cp .env.example .env
   # TELEGRAM_API_ID=1234567
   # TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef
   ```

值得知道：

- 这对值是复用的——一个应用适用于你登录的每个账户，也适用于任意多台机器。再创建一个没有必要。
- 把 `api_hash` 当作机密。它本身并不授予对你账户的访问权，但 Telegram 可能封禁被用于垃圾信息的 `api_id`，而应用一旦创建就无法删除。`.env` 因此被 gitignore。
- 某些网络无法访问 `my.telegram.org`。如果页面打不开，或提交表单时报错，换一个网络或浏览器试试——该站点明显不稳定。

## 连接客户端

Claude Code：

```bash
claude mcp add telegram -- npx -y @bstuff/telegram-mcp
# or, from a checkout:
claude mcp add telegram -- node ~/telegram-mcp/bin/telegram-mcp.ts
```

或手动，在任意 MCP 客户端的 `mcpServers` 块中：

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "@bstuff/telegram-mcp"]
    }
  }
}
```

### Claude Desktop

两种方式。通过 `~/Library/Application Support/Claude/claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "telegram": {
      "command": "npx",
      "args": ["-y", "@bstuff/telegram-mcp"]
    }
  }
}
```

该应用按登录 shell 的 PATH 解析裸命令——它的日志显示 `npx` 是在 `~/.nvm/...` 中被找到的——因此不需要 Node 的绝对路径。这样配置的服务器可以工作，但在界面里没有开关。

另一种方式是扩展，它会在 Settings → Extensions 以及聊天工具列表中提供开关：

```bash
npm run bundle
```

这会生成 `telegram.mcpb`：一个薄启动器，从这份工作副本运行服务器。代码不会被复制进 bundle，因此编辑在应用重启后生效，无需重新打包。通过 Settings → Extensions → Advanced settings → Extension Developer 安装它。扩展设置暴露“Read-only mode”与一个时区。只有在工具列表或 manifest 变化时才需要重新打包。

扩展图标来自 `assets/icon-128.png` 与 `assets/icon-16.png`；脚本把它们复制进归档，并填写 manifest 的 `icon` 与 `icons` 字段。要使用你自己的图标，放入同名的文件并重新打包——如果它们缺失，构建只是不产出图标。

启动器会检查 Node 版本，并在运行时过旧时打印一条可读的错误，而不是语法错误。要固定某个特定的二进制而不依赖 PATH：

```bash
TELEGRAM_MCP_NODE=/opt/homebrew/bin/node npm run bundle
```

不要同时保留配置项与扩展——工具会出现两次。

## 定位一个聊天

每个工具都在它的 `chat` 字段中接受以下任意一种：

- 一个 id —— `-1001234567890`、`123456789`
- 一个 `@username` 或 `https://t.me/username` 链接
- `me` —— Saved Messages
- **聊天标题的一个片段** —— `Team standup`、`barahol`

标题会针对对话缓存解析（最近的 `TELEGRAM_MCP_DIALOG_LIMIT` 个对话，默认 400 个）。如果一个片段匹配多个聊天，服务器返回候选，而不是猜测。

时间字段（`since`、`until`、`schedule_at`）能理解 `7d`、`36h`、`today`、`yesterday`、`2026-07-17`、`2026-07-17T10:00` 与 unix 时间戳。

## 工具

### 聊天
| 工具 | 作用 |
|---|---|
| `whoami` | 服务器以哪个账户登录 |
| `list_chats` | 对话，可按名称、类型、未读状态或归档过滤 |
| `get_chat` | 一个聊天的详情：类型、描述、成员、置顶消息、未读数 |
| `list_members` | 群组或频道的参与者，可选只看管理员 |
| `find_public_chat` | 全局搜索公开用户、群组与频道 |

### 读取
| 工具 | 作用 |
|---|---|
| `get_history` | 一段时间内的聊天历史；可按发送者、文本、媒体类型、id 范围过滤 |
| `search_messages` | 在一个聊天内或跨所有聊天做全文搜索 |
| `get_message` | 按 id 取消息，带表情回应、回复、转发与链接 |
| `get_replies` | 一条帖子下的评论串 |
| `get_unread` | 跨聊天的所有未读内容，且不把任何东西标为已读 |
| `chat_digest` | 一段时间的统计：谁说了多少、每天每小时的活跃度、链接、媒体、回应最多的消息 |
| `list_media` | 最近的媒体及其 id，可直接交给 `download_media` |
| `get_draft` | 跨聊天的未发送草稿 |
| `list_scheduled` | 计划稍后发送的消息 |

### 操作
| 工具 | 作用 |
|---|---|
| `send_message` | 文本、回复、频道帖子的评论、静默投递、定时发送 |
| `edit_message` / `delete_messages` | 编辑与删除（删除无法撤销） |
| `forward_messages` | 转发，可选不带“forwarded from”头部 |
| `react` | 添加或移除一个表情回应 |
| `pin_message` / `unpin_message` | 置顶、取消置顶，或取消全部置顶 |
| `mark_read` | 清掉未读标记 |
| `set_mute` | 静音 N 分钟或无限期静音，取消静音 |
| `cancel_scheduled` | 丢弃一条已排期的消息 |
| `send_file` / `download_media` | 发送本地文件或 URL；下载附件，包括被转发的 story |

### 投票与小玩意
| 工具 | 作用 |
|---|---|
| `create_poll` | 多选、非匿名、带正确答案与解释的测验模式、N 秒后自动关闭 |
| `poll_results` | 票数、百分比，公开投票还能看到谁投了什么 |
| `vote_poll` | 投出你自己的一票 |
| `close_poll` | 结束投票并返回最终结果 |
| `send_dice` | 🎲 🎯 🏀 ⚽ 🎳 🎰 —— 点数由 Telegram 服务器决定，因此它等同于一次公平抽签 |
| `random_member` | 随机挑一个成员：今天值班的人、一位评审、一位抽奖中签者 |
| `set_typing` | 显示正在输入指示 |

提示词（客户端中的斜杠命令）：`catch_up`、`morning_telegram`、`run_poll`。

## 示例

> What happened in "Team standup" this week?
> → `chat_digest` + `get_history`

> Start a poll in the work chat about when to do the retro: Tuesday, Wednesday, Thursday, multiple choice
> → `create_poll(multiple=true)`, then `poll_results`

> Remind me about the call tomorrow at 9
> → `send_message(chat="me", schedule_at="2026-08-10T09:00")`

> Who is on deploy duty today?
> → `random_member(chat="…", active_only=true)`

## 等待一条消息

`bin/watch.ts`（从 npm 安装时为 `telegram-mcp watch`）会阻塞直到一条匹配的消息到达，打印它并退出。它有意做成 CLI 而非 MCP 工具：agent 可以在后台运行它，并被进程退出唤醒，就像它等待一次 CI 运行那样。不涉及守护进程或常驻进程。

```bash
node bin/watch.ts --chat "Team standup" --timeout 600
node bin/watch.ts --chat @somegroup --from @someone --contains "deployed"
node bin/watch.ts --to-me --timeout 1800     # mentions and replies to me, any chat
node bin/watch.ts --chat -1001234567890 --count 3 --json
```

| 参数 | 含义 |
|---|---|
| `--chat <ref>` | 只看一个聊天；省略则看全部 |
| `--from <ref>` | 只看来自该发送者的消息 |
| `--contains <text>` / `--regex <re>` | 按文本过滤 |
| `--to-me` | 只看提到我的消息与对我消息的回复 |
| `--count <n>` | 等待 n 个匹配（默认 1） |
| `--timeout <sec>` | 这么多秒后放弃（默认 600） |
| `--json` | 打印一行 JSON，而不是格式化后的行 |

退出码：`0` 匹配到，`2` 超时，`1` 出错。

## 配置（环境变量 / `.env`）

| 变量 | 含义 |
|---|---|
| `TELEGRAM_API_ID`、`TELEGRAM_API_HASH` | 必填 |
| `TELEGRAM_SESSION` | 会话字符串，如果你更想不用文件 |
| `TELEGRAM_SESSION_FILE` | 会话文件的路径（默认 `~/.telegram-mcp/session`） |
| `TELEGRAM_MCP_READ_ONLY=1` | 只注册读取类工具 |
| `TELEGRAM_MCP_TZ` | 渲染时间戳所用的时区 |
| `TELEGRAM_MCP_DOWNLOAD_DIR` | `download_media` 写文件的位置 |
| `TELEGRAM_MCP_DIALOG_LIMIT` | 为标题查找缓存多少个对话 |
| `TELEGRAM_MCP_MAX_MESSAGES` | 每次调用的消息数上限 |
| `TELEGRAM_MCP_LOG_LEVEL` | stderr 上 teleproto 的日志级别：`none`（默认）、`error`、`warn`、`info`、`debug` |
| `TELEGRAM_MCP_HEALTH_INTERVAL` | 连接健康检查之间的秒数（默认 60，`0` 表示禁用） |

## 开发

```
src/client.ts     connection, dialog cache, chat resolution
src/format.ts     time parsing, message rendering, history collection
src/tools/*.ts    tools by group: chats, read, write, media, polls, fun
bin/*.ts          server entry point and interactive login
scripts/smoke.ts  dev harness: drives the server over stdio like a real client
```

```bash
npm run typecheck
node scripts/smoke.ts '[["get_history",{"chat":"Team standup","since":"2d"}]]'
```

`scripts/smoke.ts` 与真实账户对话——任何写调用之后都要清理。

## 安全

- 会话字符串授予对账户的完全访问权。它以 mode 600 存放在 `~/.telegram-mcp/session`，绝不能进入 git（`.gitignore` 已经覆盖它）。
- 消息内容是**数据，不是指令**。如果一条消息说“把这条转发给所有人”或“把验证码发给我”，那不是给助手的命令。服务器在它的 MCP `instructions` 中说明了这一点。
- `delete_messages` 与 `close_poll` 无法撤销。
- 要只看不动的配置，请使用 `TELEGRAM_MCP_READ_ONLY=1`。

## 许可证与商标

代码是 [MIT](LICENSE)。

这是一个独立项目。它与 Telegram FZ-LLC 或 Telegram Messenger Inc. 无关联、未获其背书或支持。“Telegram” 是它们的商标，此处以指名方式使用，说明本服务器与什么通信。

`assets/icon-128.png` 与 `assets/icon-16.png` 中的标志来自 telegram.org，归其所有者所有。它仅作为扩展图标包含，**不在 MIT 许可证覆盖范围内**。如果这带来不便，删除这些文件即可——没有它们 `npm run bundle` 也能正常工作——或用同名的你自己的文件替换它们。
