# Agent Note：桌面 Host 使用登录 shell 的 PATH

Status: implemented

[English](2026-10-15-desktop-host-uses-login-shell-path.md) | 中文

## 问题

由 Aeven.app 从 Finder 或 Dock 启动的桌面 Host 以 `PATH=/usr/bin:/bin:/usr/sbin:/sbin` 运行，这是 macOS 给 GUI 应用的最小 PATH。`chrome-devtools-mcp` 与 Playwright MCP 服务器通过 `npm exec` 启动，因此二者都未运行，模型没有操作 Host 在 9333 端口的 Chrome 的浏览器工具；由内置 Node.js 以绝对路径启动的 MCP 服务器不受影响。shell 命令同样缺少 Homebrew 及其他用户安装的工具。从终端启动的 Host 会继承完整 PATH，因此该故障只在 GUI 启动后出现。2026-10-15，一个会话用手写的 CDP 脚本绕过缺失的工具，并把这一绕行方法作为习得的流程存入记忆。

## 决策

在启动或接入 Host 之前，Electron 桌面壳运行一次用户的登录 shell（`$SHELL -ilc`，macOS 上回退为 `/bin/zsh`，其他平台为 `/bin/sh`），并从标记之间读取其 PATH，使启动文件的输出无法破坏该值。登录 shell 的条目在前，其缺少的继承条目在后，并去除重复项；结果替换 `process.env.PATH`，由 Host 及其子进程继承。查询限时十秒。失败时保留继承的 PATH，桌面壳记录一条警告。Windows 应用会继承用户的 PATH，因此该查询不在 Windows 上运行。

## 考虑过的替代方案

**在前面添加固定目录，例如 `/opt/homebrew/bin`。** 这会漏掉版本管理器、pnpm 以及用户 shell 配置的所有其他位置。

**打包 `chrome-devtools-mcp` 与 Playwright，并用内置 Node.js 启动。** 这样在用户未安装 Node.js 时也能工作，但无法修复 shell 命令，还会改变种子包与 MCP 配置；它仍是另一项独立改进。

**使用维护中的 shell 环境包。** 它会复制整个环境而不只是 PATH，并为大约二十行代码给桌面壳增加一个需要打包的依赖。

## 后果

GUI 启动能找到与终端启动相同的工具，因此在安装了 Node.js 时浏览器 MCP 服务器能够启动。启动时会等待登录 shell 一次，在报告问题的机器上约 300 ms。启动文件等待输入的 shell 会达到十秒限制，并回退到继承的 PATH。按用户要求，验证仅包含 TypeScript、仓库构建，以及从 macOS GUI 最小 PATH 运行该查询。
