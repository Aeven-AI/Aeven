# Agent Note：灵感页的幻灯片画廊与内置 Slides 技能

Status: implemented

[English](2026-11-12-inspiration-slides-gallery.md) | 中文

## 问题

用户请 Aeven 做演示文稿时，得到的是临时拼凑的成果：智能体在网上搜模板，用 python-pptx 生成 PowerPoint，再经 Keynote 转一遍，结果 Windows 上的 PowerPoint 打开时会提示修复。用户没有地方挑选设计，外观无法复现，桌面端与托管会话的表现也不一致。

## 决策

Imagine 起始地址改为 Inspiration（灵感）。`/inspiration` 是“图片和视频”，每个类别胶囊都是其下的独立起始地址（`/inspiration/slides`、`/inspiration/letters`、`/inspiration/websites`、`/inspiration/apps`），各有自己的输入框占位文字；胶囊条沿用 Bots 页面的切换样式，两个页面的胶囊间距都是 8px。

“幻灯片”类别为每个演示模板显示一张卡片：图片卡上是该模板的封面幻灯片，高度与每行四张的图片卡一致。点开卡片会弹出基于图片提示弹窗外壳的窗口：当前幻灯片、全部二十张幻灯片的缩略条、简介、可选的“上传现有演示文稿、PDF 或文档”选择器，以及“使用模板”——它会附上这些资料，并把用该模板制作演示文稿的请求写入输入框。为了让插槽组件附加文档，公开的输入动作在 `addImageFiles` 旁新增了 `addFiles`，背后与输入框的文件附件共用同一套上传入口。

模板及其生成器放在独立的模板仓库（`templates/slides`），发布进 `aeven` 预设，成为内置的 `slides` 技能，因此每个桌面与托管会话无需安装即可使用。演示文稿是按固定幻灯片类型（封面、议程、指标、时间线、图表、自定义 HTML 等）组织的 JSON 内容；每个设计系统都绘制全部类型，所以任何演示文稿都能用 36 个模板中的任意一个渲染，并保持该模板的设计。渲染器输出内嵌 Google Fonts 的自包含 HTML；一个打包好的导出器把它转为 PDF、带原生可编辑文本框与演讲者备注的幻灯片图片 PPTX，以及 Keynote，使用已安装的 Chrome 系浏览器、托管沙箱里的 Playwright Chromium，或一次性下载的 Chrome Headless Shell。技能要求智能体走一个简短向导：一轮 `ask_user_question` 提问、确认大纲、生成、溢出检查、再修改。画廊图片（`apps/web/public/slide-templates/`）由同一仓库的 `gallery.mjs` 生成。

## 考虑过的替代方案

**保留 python-pptx 与逐形状生成 PPTX 的代码。** 每台机器都需要 Python，每个版式还要维护第二份副本；从渲染好的 HTML 导出，一次覆盖所有版式。

**通过技能目录发布技能。** 目录里的技能要用户安装后才进入会话，一键“使用模板”无法依赖它。

**把导出器做成 Host 工具。** 这样可避免在沙箱里运行 Chrome，但需要新的能力接缝；沙箱内的导出器在桌面端可用，并能使用托管镜像已有的浏览器。

## 后果

“幻灯片”依赖两个仓库：模板的修改在 `templates/slides` 中完成，经 `scripts/publish.mjs` 和 `scripts/gallery.mjs` 进入 Aeven，两者合计约增加 20 MB（随包交付的技能及其字体，以及 36 套画廊图片）。导出在会话沙箱内运行，因此没有 Chrome 系浏览器的机器会一次性下载约 100 MB 的 Chrome Headless Shell；托管会话使用其沙箱镜像自带的 Chromium。PPTX 的幻灯片是图片上叠加可编辑文本，所以版式修改要通过演示文稿 JSON 而不是 PowerPoint。“使用模板”向输入框写入的是普通文字，因此由技能而不是页面决定工作流程。

## 验证

在运行中的桌面应用里检查了灵感页、深链接、弹窗、文件附件和全部 36 张卡片；一个真实会话从“使用模板”经过提问、大纲和生成，在工作区沙箱内得到了 PDF 与 PPTX。每个模板的示例演示文稿导出时溢出检查均无报告；PPTX 输出经 LibreOffice 与 Keynote 与 PDF 对比过。
