# Agent Note：生成的文件可在 Aeven Web 上打开

Status: implemented

[English](2026-11-15-produced-files-on-web.md) | 中文

## 问题

在 chat.aeven.io 上，对话运行在用户的桌面端，会话同步把它显示在网页上。在桌面端生成的简历以生成文件列表收尾，列出 `cv.pdf`、`cv.docx` 和 `cv.pages`，但在网页上每个文件都返回“not found”。PDF、Word 和 Pages 文件没有 Files 侧栏查看器，因此列表从页面自身来源的 `/api/workspace-file` 下载它们；为 chat.aeven.io 提供服务的云端 Host 只允许读取账户文件夹，而 `/Users/…/.aeven/chats/cv/…` 只存在于 Mac 上。

## 决策

桌面端为每个生成的文件在对话中保留一份副本。`avn-tool-bash` 新增 `copyOutputFiles`：命令在 `output_files` 中列出并生成的每个非图片文件都存为文件附件（无论是否在工作区内），其 `producedFiles` 条目记录附件 id，并以 `copy` 记录完整引用。调用处不展示任何内容，模型看到的结果不变，因此对话记录和模型看到的与之前相同。`avn-web-app` 为 `aeven` 预设的 `tool-bash` 行启用它；`avn-hosted-app` 用自己的 `shareOutputFiles` 替换该行的整个 `config`，两个选项同时启用时拒绝加载。

会话同步本就会发布事件中以 `sha256:` id 提到的每个附件，`/api/attachment-file` 本就会提供在工具结果 `meta` 中找到的文件引用，`show_motion` 的影片就是这样使用的。页面无法打开 Host 路径时，生成文件列表从这份副本下载文档，否则从 `/api/workspace-file` 下载。Files 侧栏可以预览的文件（例如 `deck.html`）也改用副本：当 Host 对某个路径返回 `workspace-file/outside-workspace` 或 `workspace-file/not-found` 时，侧栏报告无法预览，而不是打开一个显示错误的面板。在非 loopback 页面上，收尾正文中的行内提及也打开同一份副本；`ChatFileMentions.forClosing` 会收到用于构造副本 URL 的 Session id。命令声明了 `output_files` 的轮次在该行和正文链接中只列出这些输出，因此简历的 `cv.json` 不会出现。

托管沙箱以只读方式挂载 `aeven` 预设的技能，使云端对话可以运行简历和演示文稿导出器；两个导出器都能在 Linux ARM 上找到沙箱中的 Playwright Chromium（`chrome-headless-shell-linux-arm64`）。

## 考虑过的替代方案

**点击时获取。** 网页在点击文件时向桌面端请求该文件。在此之前不会上传任何内容，但只有桌面端在线时才可用，并且需要一个目前不存在的 Host 间请求通道；用户选择了同步副本。

**在桌面端启用 `shareOutputFiles`。** 它会拒绝工作区之外的声明路径，而在桌面端这包括用户自己的文件夹；它还会在调用处展示每个文件并告知模型。

## 影响

每个生成的文档在桌面端存储两份，并上传到中继一次，受单次调用（10 个文件、100 MiB）和单个对话（500 MiB）上限约束，这些上限现在也计入副本。图片不保留副本，因为图片路由不搜索结果元数据。Windows 桌面端运行 `tool-pwsh`，它没有 `output_files` 副本。

## 验证

`tool-bash` 和 `ui-deliverables` 的 `tsc` 通过。
