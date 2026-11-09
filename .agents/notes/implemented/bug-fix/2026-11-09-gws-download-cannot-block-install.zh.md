# Agent Note：gws 下载失败不能阻止安装或更新

Status: implemented

[English](2026-11-09-gws-download-cannot-block-install.md) | 中文

## 问题

2026-11-09，Desktop 0.3.39-alpha 在 macOS x64、macOS arm64、Linux 和 Windows 上更新后无法启动。更新的 profile 安装会运行 `@aeven/host-account-integrations` 的 postinstall `scripts/ensure-gws.mjs`，它从 `googleworkspace/cli` 的 GitHub 发布下载 `gws` 二进制文件。GitHub 的浏览器下载路径（`github.com/<repo>/releases/download/...`）对部分资源返回 504，失败的资源在每次请求之间变化。postinstall 抛出错误，`pnpm install` 以 1 退出，暂存安装使 Desktop 启动停止。只有 Gmail、Google Drive 和 Google Calendar 连接器运行 `gws`。

## 决定

**下载在两条路径上重试。** 每次尝试先走浏览器下载路径，再走 REST 资源路径（`api.github.com/repos/<repo>/releases/assets/<id>`，带 `Accept: application/octet-stream`），后者提供了浏览器路径返回 504 的资源。共三轮，轮次之间等待 1 秒和 2 秒，归档仍必须与其发布的 `.sha256` 一致，二进制文件完整写入后才重命名到位。

**postinstall 是可选的；连接器按需安装。** postinstall 传入 `--optional`，因此安装失败时打印警告并以 0 退出。当 `GWS_BIN` 路径不存在时，`googleConnection` 不带 `--optional` 运行该脚本。同一 Host 进程中的并发连接共享一次安装，安装失败只会使该连接失败，并在下一次连接时重试。

## 验证

在 macOS arm64 上：全新运行安装了 `gws 0.22.5`。通过不可达的 `HTTPS_PROXY` 阻断网络时，`--optional` 带警告以 0 退出，严格运行以 1 退出。删除二进制文件后两个并发 `googleConnection` 调用重新安装了一个与原文件逐字节相同的二进制文件。浏览器路径返回 504 的 x64 macOS 资源通过 REST 路径下载并通过了校验和。

## 后果

- 无法访问 GitHub 的安装会让 Google 连接器在首次连接时安装 `gws`，该连接会等待下载完成。
- REST 资源路径使用 GitHub 未认证 API 配额（每个 IP 每小时 60 次请求），且仅在浏览器路径失败后使用。
