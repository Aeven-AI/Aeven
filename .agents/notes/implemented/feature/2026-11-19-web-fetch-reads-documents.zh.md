# Agent Note：web_fetch 读取 PDF 与 Office 文档

Status: implemented

[English](2026-11-19-web-fetch-reads-documents.md) | 中文

## 问题

在 Æven Web 上，一位用户询问一项政府招标的参与者名单。该名单以 PDF 形式发布在 TenderNed 上，模型回答说它无法用自身工具打开 PDF，只能通过用户机器上的浏览器读取。`avn-web-fetch-http` 只把 HTML、`text/*` 与 JSON/XML 响应归类为可读，因此每个 `application/pdf` 响应都以 `WEB_UNSUPPORTED_CONTENT_TYPE` 失败。招标网站、政府部门与期刊以 PDF、Word 与 Excel 文件发布其主要文档，所以普通抓取读不到用户在研究任务中最常询问的材料。Host 已经通过 `ctx.documentExtract` 为文件上传读取同样的格式。

## 决策

`WebFetchBody` 新增 `document` 分支，携带完整文件字节、响应媒体类型，以及取自 `Content-Disposition` 或 URL 最后一个路径段的文件名。`avn-web-fetch-http` 把 PDF、Word、Excel、PowerPoint、OpenDocument、RTF、EPUB 与 `application/octet-stream` 归类为 `document`，在独立的 `maxDocumentBytes` 上限（默认 25,000,000）内读取主体，并以 `WEB_FETCH_TOO_LARGE` 拒绝更大的文档，因为按字节截断的 PDF 或 ZIP 容器无法解析。以 `%PDF-` 开头的 `application/octet-stream` 主体被标为 `application/pdf`。`Accept` 头新增 `application/pdf;q=0.8,*/*;q=0.5`，使进行内容协商的服务器返回该文件。

`avn-tool-web` 在 `web_fetch` 内通过可选的 `ctx.documentExtract` 服务（`ctx.get`）转换 `document` 主体，并转发工具调用信号。记录的输出值以 `{ kind: 'document', mediaType, content }` 取代字节，结果头为 `Fetched <url> (HTTP <status>, text extracted from <media type>)`，没有文本层的文档渲染为 `[The document contains no extractable text.]`，提取器截断文本时结果标记为 `truncated`。缺少该服务或没有已注册读取器接受该格式时，调用以 `WEB_UNSUPPORTED_CONTENT_TYPE` 失败。工具描述列出可读格式。挂载 `ctx.documentExtract` 时，`tool:web_fetch` 系统提示段落会补充说明 `web_fetch` 返回这些格式的文本，并且文档 URL 应通过 `web_fetch` 抓取，而不是下载后在 shell 中转换；否则在 Aeven Cloud 上模型会认为 `web_fetch` 无法读取 PDF，转而在 Bash 中运行 `curl` 与 `pdftotext`。没有读取器时该句不出现，因此提示从不承诺部署无法读取的格式。

提取在文档提供方的 worker 线程中、在 `web_fetch` 预算（`fetchTimeoutMs`，默认 30 秒）内运行；超时会中止信号并终止 worker。一份 2.2 MB、15 页的 PDF 下载约 0.5 秒，提取约 0.5 秒。挂载 `document-extract-ocr` 时，扫描版 PDF 会转入 OCR，通常会超过 30 秒预算。

## 考虑过的替代方案

- **在 `avn-web-fetch-http` 内提取文本。** 提供方将需要文档注册表，并返回不再表明其来自文档的文本。在接缝上保留字节让每个 Consumer 自行选择：`web_fetch` 提取，`avn-tool-image-search` 忽略非 HTML 主体。
- **像文本一样截断大文档。** 截断的 PDF 会丢失交叉引用表，截断的 Office 文件会丢失 ZIP 目录，因此截断产生的是无法读取的主体，而不是更短的主体。
- **接受图像、音频、视频与压缩包。** 它们需要视觉、转写或解包路径，而非文本提取；招标网站上的 ZIP 包仍不受支持。
- **让用户通过浏览器打开 PDF。** 这正是已发布的行为与被报告的故障。

## 后果

模型可以从 URL 读取已发布的报告、招标文件、论文与电子表格，会话日志记录模型看到的提取文本。一份长文档最多可向上下文返回 `fetchMaxOutputChars`（200,000 字符），与 HTML 的上限相同。文档抓取与文件上传共用提取 worker（`document-extract-js` 并发数为 2）。没有 `document-extract` 的组合（包括 headless 与 SDK profile）现在通过 `web_fetch` 把文档报告为不可读，错误码与之前相同，消息指出缺少读取器。旧式 `.doc`、`.xls` 与 `.ppt` 文件需要 `document-extract-office`。

## 测试

`packages/web/web-fetch-http/tests/fetch-http.spec.ts` 覆盖文档归类、文件命名、整体读取、PDF 签名，以及文档字节上限恰好达到、超过与声明超过的情况。`packages/web/tool-web/tests/tool-web.spec.ts` 覆盖经由真实 `DocumentExtract` 注册表的提取、结果头、空文本标记、提取器截断与两条失败路径。`snapshots/session/web-fetch-document` 场景记录了对一个不带文件扩展名的夹具 PDF 的实时抓取，以及模型根据其文本给出的回答。
