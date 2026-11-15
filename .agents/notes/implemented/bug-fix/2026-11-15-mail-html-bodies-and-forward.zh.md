# Agent Note：邮件把仅有 HTML 的正文读为文本，并连同 HTML、内嵌图片与附件转发邮件

Status: implemented

[English](2026-11-15-mail-html-bodies-and-forward.md) | 中文

## 问题

对于只带 `text/html` 部分的邮件（例如 Microsoft 支持邮件），`mail_read` 不返回任何文本：头部和一个徽标附件能读到，因此模型看到的是一封空邮件，而它在邮件客户端里能正常阅读（#648）。`toMailMessage` 只使用 `parsed.text`，而 mailparser 只为单独的根 HTML 部分把 HTML 转为文本，因此带内嵌图片的 `multipart/related` HTML 正文，或真实 HTML 旁的空 `text/plain`，到达时都没有可用文本。邮件也无法转发：`mail_send` 只提供发送、回复与草稿，转交一封邮件就得把它重新打成纯文本，丢掉格式、图片与附件。

## 决策

- `toMailMessage` 在 `text/plain` 部分有可见文本时保留它，否则用 `html-to-text`（已经通过 mailparser 存在于依赖树中，现在是直接依赖）转换 `parsed.html`：不折行，跳过图片，链接保留其 URL，除非 URL 与链接文字相同。`MailMessage.textSource` 记录 `plain` 或 `html`，对 `html`，`mail_read` 会添加 `(The message has no plain-text part; this text was converted from its HTML.)`。纯文本邮件的呈现与之前相同。
- HTML 正文内嵌的附件（mailparser 的 `related`）带 `inline: true`，并在附件清单中读作 `, inline in the body`。它保留自己的序号，因此 `saveAttachments` 仍能保存它。
- `MailSendRequest.forward` 指明要转发的邮件。服务从账户读取它，依次发送发件人的文本、一个 `---------- Forwarded message ---------` 块（From、Date、Subject、To、Cc）以及原邮件的可读文本；原邮件有 HTML 时，HTML 备选正文在原邮件的头部 `<style>` 块与正文内容上方带同样的块。原邮件的每个部分都会附上，内嵌图片保留 Content-ID，使转发的 HTML 仍能显示它们。主题默认为 `Fwd: …`，同一请求不能既回复又转发，转发也可以保存为草稿。发送仍然请求审批，理由为 `Send a forwarded email from ${account} to ${to}.`

## 考虑过的替代方案

**把原邮件作为 `message/rfc822` 附上。** 它逐字节保留邮件，但若干客户端把它显示为要打开的文件而非内联内容，收件人看到的是一个附件而不是邮件。

**从附件清单中去掉内嵌图片。** 它们不再显示为附件，但模型就无法再保存其中之一，而且 `mail_read` 与 `saveAttachments` 之间的序号会错位。

## 后果

读取仅有 HTML 的邮件所耗的 token 与其可见文本相当，仍受 `bodyMaxChars` 约束。转发会发送原邮件的完整大小，读取原邮件时受 `messageMaxBytes` 约束。模型仍然只编写纯文本；为出站邮件编写 HTML 或附加工作区文件仍属延期工作。

## 验证

一封形如 #648 的 `multipart/related` 仅 HTML 邮件（带 `cid:` 徽标的 HTML 正文）经 `toMailMessage` 解析后返回 `Dear Olivier, …`，`textSource: 'html'`，徽标被标为内嵌；一封纯文本邮件原样返回正文，`textSource: 'plain'`。把它经 `forwardParts` 与 `composeMessage` 转发并解析结果，得到主题 `Fwd: …`、仍包含 `cid:logo`、头部样式与链接的 HTML，以及作为 related 附件、Content-ID 为 `logo` 的徽标。
