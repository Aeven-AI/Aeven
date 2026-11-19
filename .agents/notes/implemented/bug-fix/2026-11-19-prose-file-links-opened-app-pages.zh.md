# Agent Note：回复中的文件链接打开了 404 页面

Status: implemented

[English](2026-11-19-prose-file-links-opened-app-pages.md) | 中文

## 问题

托管宿主的一位用户点击助手在回复中链接的求职信，得到的是 chat.aeven.io 的 404 页面。回复中写的是 `[letter.pdf](Applications/<company>/letter.pdf)`，一个相对于工作区、且文件确实存在的路径。引擎的 `a` 组件原样渲染每个目标并带 `target="_blank"`，于是浏览器把该路径按应用源站解析，请求了 `https://chat.aeven.io/Applications/<company>/letter.pdf`，nginx 记录为 404。同一会话还有 15 个形如 `[cv.pdf](../attachments/86/<sha256>)` 的链接，模型根据共享工具返回的 `attachmentId` 拼出它们；它们解析到 `/attachments/…`，源站同样返回 404。此前只有收尾轮次产出文件的行内代码提及可点击，而 `LINK_SAFETY` 以“本地单用户工具”为前提放行相对链接目标。

## 决定

- `MarkdownText` 接管所有目标不带协议、不是协议相对地址、也不是 `#` 片段的链接：调用方的 `fileLinks` 解析器提供其 URL 和打开函数；没有解析器或未匹配时，链接渲染为纯文本。网页链接与脚注跳转仍交给引擎自身的 `MarkdownLink`，`@aeven/client-hypermarkdown` 现已导出它。
- `ui-deliverables` 通过 `chatFileMentions.forLinks(owner, sessionId)` 提供解析器，`AssistantNodeView` 在每个助手步骤（而不只是收尾步骤）请求它，因为回复常会点名更早轮次产出的文件。路径按产出文件标签的方式打开（`file-links.ts` 中的 `openProducedFile`，两处现已共用）：先在侧栏预览，其次在能打开路径的 loopback 页面上由宿主打开，否则通过 `/api/workspace-file` 下载。`attachments/<xx>/<sha256>` 目标通过 `/api/attachment-file` 下载该存储副本。
- 会话列表行没有 `cwd` 时，`ui-chat` 的 `openFile` 按 `workspaceFiles.list(sessionId, '')` 报告的工作区根目录解析相对路径。项目之外的聊天在列表行上没有 `cwd`，却运行在 `~/.aeven/chats` 中，而宿主的打开器把裸路径按自身进程目录解析，因此桌面端报错 `The file …/.desktop-build/development/project/link-test/letter.pdf does not exist`。
- `tool-bash` 记录未声明的文档。在一次实机测试中，模型用文件工具写出 `letter.html`，再用无头 Chrome 打印成 `Motivation_Letter.pdf`，却没有列出 `output_files`，于是已创建文件块显示 HTML 而不是 PDF。前台命令未声明 `output_files` 但提到 `detectOutputExtensions` 中的扩展名时，工具在命令前后列出工作区，把每个新建或修改、且扩展名出现在命令中的文件记录为声明输出；文件块随即显示 PDF 而不是 HTML。若改为监视所有配置的类型，还会记录模型用 `pdftoppm -png` 渲染来检查 PDF、随后又删除的 `page-1.png` 预览。
- 点击总是运行打开函数而不跟随 `href`：在桌面外壳中，对 `avn-app:` URL 的新标签页请求会交给系统浏览器，而系统浏览器无法加载它。锚点的 `href` 仍是文件 URL，因此复制链接可用。

## 考虑过的替代方案

- **让模型不要写指向文件的链接。** 已否决：共享工具的结果已经要求不要在回复中重复已共享的文件，模型仍写出了这些链接。
- **像提及一样只解析收尾轮次的产出文件。** 已否决：这封求职信产出于链接它的回复之前两个轮次，按该规则它会保持惰性。
- **在侧栏打开存储副本。** 暂缓：附件链接不含可据扩展名选择查看器的路径，而回复下方的文件标签已能预览共享文件。

## 影响

渲染应用自身相对链接且希望其可点击的 Markdown 表面，必须传入 `fileLinks` 或改写为绝对 URL；否则链接显示为纯文本。宿主无法提供的路径会把路由的 404 响应体作为下载，而不是显示应用的 404 页面。
