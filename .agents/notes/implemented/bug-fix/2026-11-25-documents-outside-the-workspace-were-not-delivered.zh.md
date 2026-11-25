# Agent Note：在工作区之外生成的文档未被交付

Status: implemented

[English](2026-11-25-documents-outside-the-workspace-were-not-delivered.md) | 中文

## 问题

2026-11-25，一个在 `~/Documents/Aeven/chats` 中运行的桌面会话请求一份税务异议附件。模型用 `write` 在工作区旁的项目文件夹 `~/Documents/Aeven/bezwaar-ib-2023-ondernemerschap/` 中写出 `toelichting.html`，然后运行 `cd <folder> && Chrome --print-to-pdf="$PWD/toelichting.pdf" …` 和 `textutil -convert docx …`，没有声明 `output_files`。2026-11-19 的检测只列出工作区根目录，所以两个文件都没有被记录：已创建文件块显示的是 HTML，回复中的内联代码路径保持不可点击，因为提及只解析已生成文件，而回复中的 `[…](file:///…/toelichting.pdf)` 链接因为 `file:` 不是允许的协议而显示为文本。只有后来把两个文件 `cp` 进工作区才产生了文件行。同一会话早些时候，四次无头 Chrome 打印在工作区沙箱内失败：Chrome 自己的沙箱无法在其中启动，它的默认配置文件和 `mktemp -d` 文件夹不在沙箱允许写入的范围内，所以它只打印 crashpad 错误而没有写出任何文件。模型断定无法生成 PDF，转而交付了 DOCX。

## 决定

- `tool-bash` 在 `detect-outputs.ts` 中关注命令工作的文件夹：它的 `workdir`、每个 `cd` 目标，以及命令以受关注扩展名提到的每个路径所在的文件夹，并展开 `~`、`$HOME` 和 `$PWD`。这些文件夹在命令前后只列出一层，关注命令提到的扩展名以及 `detectDocumentExtensions`（默认 PDF、Office、iWork、ePub），因此在 `deck.html` 旁写出 `deck.pptx` 却未提到它的导出脚本也会被记录。工作区仍只对提到的扩展名递归列出。工作区之外的文件夹在未开启 `shareOutputFiles` 时计入；临时文件夹和隐藏文件夹下的文件夹从不计入，从而排除 `qlmanage -t -o /tmp` 预览和 `.chrome-profile`。
- 检测包裹正常的前台路径而不是替代它，所以提到 `.pdf` 的命令在 `detachAfterMs` 后仍会转为后台作业；转入后台的命令不记录任何文件。
- `MarkdownText` 让 `file:` 链接通过链接安全检查，并把 `file://` URL 的路径交给 `fileLinks` 解析器，使其像裸路径一样打开；没有解析器或没有匹配时显示为文本，绝不作为 `file:` 锚点。
- `aeven` 预设附带 `documents` 技能：交付对方指定的格式（未指定时为 PDF），绝不交付 HTML，并用 `--headless=new --no-sandbox` 以及文档旁隐藏文件夹中的 `--user-data-dir` 打印，这正是该会话唯一一次成功打印所用的参数。Word 只在被要求时用 `textutil`、`soffice` 或 `pandoc` 生成，Pages 只在被要求时通过带沙箱提升的 `osascript` 由 Pages 转换。

## 考虑过的替代方案

- **列出该轮中模型接触过的每个文件夹。** 否决：`read` 一个满是旧 PDF 的文件夹并不表示命令会修改它们，而命令文本已经写明它在哪里工作。
- **在命令的文件夹中关注未提到的图片和媒体。** 否决：模型为检查 PDF 而渲染的页面预览和缩略图都是图片，这正是 2026-11-19 的检测要求提到扩展名的原因。
- **把 `--no-sandbox` 硬编码进沙箱配置或包装脚本。** 否决：命令由模型编写；放在生成文档之处的指引覆盖所有路径，而 cv 和 slides 导出脚本已经自行传入该参数。

## 后果

把文档写入一个既不是起始目录、也没有 `cd` 进入、也没有提到的文件夹的命令仍然无法被检测；`output_files` 仍是声明的途径。每个未声明 `output_files` 的前台命令现在会在运行前后各列出一次它的起始文件夹。
