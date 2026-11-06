# Agent Note: 托管版浏览器读取须指明读者账号的 Session

Status: implemented

[English](2026-11-06-hosted-reads-name-a-session.md) | 中文

## 问题

在托管 Web 上，经过身份验证的 `/api/file` 路由会提供 Host 已组合文件系统能读取的任何绝对路径，因此任何已登录账号都能读取 Host 自身的文件和其他账号的文件夹。`session.openWorkspacePath` 运行原生打开器前不检查 `canOpenWorkspacePath()`，因此已创建文件的行会让服务器运行 `xdg-open`；它失败只是因为该程序不存在。Files 侧栏与产出文件行没有视频或音频查看器，因此命令生成的 MP4 只显示为一行，且无法打开。

## 决定

`session-controller` 新增 `pathReads`（默认 `true`）；托管版将其设为 `false`，`/api/file` 不再注册。原生打开不可用时，`openWorkspacePath` 以 `session/open-unavailable` 拒绝。`api-workspace-files` 注册 `/api/workspace-file?sessionId&path`：它按与文本预览相同的规则（开启 `confineReads` 时限定在工作区内）相对该 Session 的工作区根解析路径，把其他账号的 Session 当作不存在而拒绝，并以 `206` 响应单个字节范围。Files 侧栏通过它读取图片、视频、音频和下载，并在 Host 没有桌面时下载无法预览的文件。产出文件行就地播放产出的视频或音频文件，并在这类 Host 上下载其他无法预览的文件。`FileKind` 新增 `video` 与 `audio`。

## 考虑过的替代方案

把 `/api/file` 限定在调用者的账号文件夹被否决：该路由不携带 Session，因此需要在 `workspace-files` 已解析的工作目录绑定之外再加一条账号到文件夹的规则。直接从磁盘流式读取字节范围被推迟，因为已组合的文件系统只提供整文件读取，而其校验读取正是防止被隔离的命令在 Host 下替换路径的手段。

## 影响

在托管版上，指向 Host 绝对路径的 Markdown 图片不再加载。每个媒体字节范围都会完整读取文件，上限为 `maxFileBytes`。桌面版保留 `/api/file`，其 Files 侧栏现在也能播放视频和音频。

## 验证

类型检查、lint、重复检测和构建均通过。改动前在 chat.aeven.io 上，已登录账号请求 `/api/file?path=/etc/hostname` 得到 200。
