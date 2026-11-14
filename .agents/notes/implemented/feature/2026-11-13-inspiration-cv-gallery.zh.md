# Agent Note：灵感页的简历画廊与内置 CV 技能

Status: implemented

[English](2026-11-13-inspiration-cv-gallery.md) | 中文

## 问题

用户请 Aeven 做简历的频率不亚于做演示文稿，但得到的是临时拼凑的文档：一份普通的 Word 文件或一次性的 HTML 页面，没有可挑选的设计，修改后外观无法保持，也没有与预览一致的 Word 或 Pages 文件。现有的简历只能重新录入到智能体生成的东西里。

## 决策

灵感页新增第三个类别胶囊“简历”（`Resumes`），有独立的起始地址 `/inspiration/resumes` 和自己的输入框占位文字。网格为每个简历模板显示一张纵向 A4 卡片：模板的整页人像封面。点开卡片会打开幻灯片的弹窗，它已成为两个画廊共用的组件（`TemplateDialog`，按画廊类型区分）：纵向形式下，当前页面在卡片允许的范围内尽量高，下方是全部页面的缩略条，并提供一个选择器用于读者现有的简历（PDF、Word、Pages 或文本）和一张人像照片，以及“使用模板”——它经 `addFiles` 附上这些文件，并把用该模板制作简历的请求写入输入框。两个网格的卡片标记都由同一个 `TemplateCard` 生成。

模板及其生成器放在模板仓库（`templates/cv`，与 `templates/slides` 并列），发布进 `aeven` 预设，成为内置的 `cv` 技能。简历是 JSON 内容（姓名、职位、照片、联系方式、技能、语言，以及时间线、列表、文本和标签分节）；设计系统把它绘制在 A4 页面上，页面内运行的分页逻辑把整条条目移到下一页，并在侧边菜单中点亮每页包含的分节。首批四个设计系统把单页简历网站重建为拼接的 A4 页面，每个都以大幅人像开篇：Black 和 White（Mee 简历网站的黑绿与白黄配色：人像封面、配有第二张照片的“关于”、技能圆环和图标时间线）、Slate（Myour：深石板灰与薄荷绿，姓名位于升入照片的圆形中，纵向时间线日期）和 Fresh（Martyn：白色与绿色，照片融入倾斜的薄荷绿色块，阴影卡片和数字计数）。另外十个重建自以 CC BY 4.0 发布的 Figma 社区简历文件（Classic、Glow、Forest、Blobs、Pulse、Portfolio、Sage、Contrast、Magic、Gridfolio）；它们通过 `scripts/blocks.mjs` 共用内容标记、侧栏与主栏的拆分以及页面外壳，只在结构和样式表上不同。另外二十六个重建自更多以 CC BY 4.0 发布的 Figma 社区简历文件（Lina 的模板包、Supa Resume 浅色与深色版、Marina、Judit、Mónica、Yoka、Peter Javorkai、Khalil、哈佛学术简历、UI/UX 套件、Enji Kusnadi、Resumate、BRIX 等），基于 `scripts/kit.mjs` 中的三种原型：侧栏、标签栏和堆叠分节。设计系统在 system.json 中的 `sample` 让其画廊图片展示各自的人物，全部是来自 Unsplash 的时尚模特人像。一个打包好的导出器输出 PDF（Chrome 打印）、DOCX 和 Pages。DOCX 的每一页是去掉文字后的设计图片，上面每行文字是一个 DrawingML 文本框，使用模板内嵌的字体；Pages 在安装字体后转换该 DOCX。画廊图片（`apps/web/public/cv-templates/`）由同一仓库的 `gallery.mjs` 生成。

## 考虑过的替代方案

**单独的 `CvDialog`。** 它会重复幻灯片弹窗的翻页、缩略条和资料选择器；重复代码检查会拒绝，而且两个画廊现在一起演进。

**用 Word 表格构建 DOCX。** Pages 不支持嵌套表格，并会丢弃单元格内的浮动图片，导入后版式崩坏；Word 自身的重排也会与 PDF 不一致。

**用带框段落（`w:framePr`）放置文字。** Oswald 这类展示字体需要比标题紧凑行距更高的行框，相邻的行因此重叠，而 Pages 会丢弃重叠框中的文字（已用最小文档验证）。文本框可以自由重叠。

## 后果

简历依赖模板仓库：模板的修改在 `templates/cv` 中完成，经 `scripts/publish.mjs`（约 4.3 MB：技能、导出器打包文件和八个字体家族）与 `scripts/gallery.mjs`（十四套页面图片，约 1.1 MB）进入 Aeven。示例照片是 Unsplash 许可下的 Unsplash 照片；源自 Figma 的模板按 CC BY 4.0 的要求，在各自的 source.json 中注明来源文件。DOCX 页面是图片上叠加可编辑文字，因此在 Word 和 Pages 中可以小幅修改措辞，版式修改则要通过 `cv.json`。Pages 导出会驱动 Pages 并安装字体，工作区沙箱会拒绝这些操作；导出器会打印在沙箱外运行的命令，与 slides 技能的 Keynote 步骤相同。

## 验证

每个模板的示例简历都渲染为一到四页 A4，没有溢出；PDF 页数与 HTML 一致，Pages 文件再导出为 PDF 后，每一行都在页面图片上的正确位置（纵向文字保留在图片中）。`ui-imagine` 的测试覆盖简历网格、纵向弹窗的翻页、资料选择器接受的文件类型、有无附件时写入的草稿、附件被拒绝的情形，以及通过共用组件打开的幻灯片弹窗；预设的技能测试接受新的 `cv` 技能。
