# Agent Note: 聊天控制侧边栏终端

Status: implemented

[English](2026-10-09-chat-sidebar-terminal-control.md) | 中文

## 问题

侧边栏通过 `terminalController` 持有用户 shell，而持久 agent 工具使用 `ctx.terminals`。聊天无法通过 agent 终端注册表访问侧边栏 shell。

## 决策

工具注册表可用时，`api-terminal-controller` 注册 `sidebar_terminal`。操作在调用 Agent 的 Session 内解析终端 id。渲染文本读取受 `maxToolOutputBytes` 限制；发送接受原始文本，并可追加 Enter。发送成功确认输入已被接受，不代表命令已完成。

Agent 输入共享 PTY 操作队列，不占用浏览器的独占连接。用户输入和工具输入按完整写入排序。由于用户 shell 不受 agent 沙箱约束，受限会话通过工具执行管线请求批准。会话授权明确指定账户、终端 id 和操作；danger-full-access 会话不需要额外授权。

## 考虑过的替代方案

将这些 shell 注册到 `ctx.terminals` 会混淆用户 shell 与受沙箱约束的 agent shell。通过浏览器自动化操作侧边栏，会让 shell 控制依赖 DOM 查找和浏览器焦点。

## 后果

Web 和 Electron 使用同一 Host 服务。模型可以列出、读取、输入、重命名、调整大小和关闭已有侧边栏终端。创建 shell 仍由侧边栏操作完成。工具调用和结果提供持久的模型历史；原始 PTY 输出和 shell 进程保留在 Host 本地。用户和 agent 并发编辑命令时，不同写入仍可能交错。

三个聚焦 Loader 测试覆盖真实 shell 状态、实时浏览器输出订阅、原始 Ctrl-C、所有者隔离、无效输入以及受限会话的授权复用。Web 应用的实时聊天通过可见 zsh 面板发送并读取 `AEVEN_SIDEBAR_CONTROL_OK`。
