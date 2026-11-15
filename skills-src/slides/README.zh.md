# Aeven Slides

[English](README.md) | 中文

演示文稿设计系统，以及把任一系统填入用户自己文字的生成器，位于 aeven 仓库的 `skills-src/slides`，旁边是 `skills-src/cv`；`scripts/publish.mjs` 把 Aeven 随附的副本写入 `packages/preset/agent-presets/presets/aeven/skills/slides`。HTML 是源文件；PDF、PPTX、Keynote 和图库图片由它导出。

```sh
pnpm install --ignore-workspace                       # its own dependencies, outside the harness workspace
node scripts/render.mjs dark-pills out                 # a system's 20-slide sample deck → out/deck-dark-pills.html
node scripts/render.mjs my-deck.json out               # a user's deck in the system it names
node scripts/export.mjs out out pdf,pptx,key           # every deck-*.html in out/ → PDF, PPTX, Keynote
node scripts/gallery.mjs out/gallery                   # slide pictures for the Aeven Slides gallery
node scripts/publish.mjs                               # ship the skill into this checkout
```

## 各部分如何组合

| 部分 | 文件 | 内容 |
| --- | --- | --- |
| 内容模型 | `scripts/deck.mjs` | 幻灯片类型及其字段（包括 `chart` 和 `custom`）；展示每个模板时使用的引导演示文稿 |
| 图表 | `scripts/charts.mjs` | 以系统配色绘制的 SVG 柱状图、条形图、折线图、面积图、饼图和环形图 |
| 设计系统 | `systems/<NN-id>/` | `system.json`（字体、令牌）、`layouts.mjs`（每种类型一个布局）、`source.json`（来源、许可） |
| 渲染器 | `scripts/render.mjs` | 演示文稿 + 系统 → 内嵌 Google Fonts 的独立 HTML |
| 导出器 | `scripts/export.mjs` | HTML → PDF、PPTX（原生形状和可编辑文字、内嵌字体、演讲者备注）、Keynote、封面；溢出警告 |
| Office 字体 | `scripts/pptx-fonts.mjs`、`scripts/pptx-package.mjs` | 每个字重对应的 Office 字体名称、EOT 字体嵌入、pptxgenjs 架构修正 |
| 已安装字体 | `scripts/installed-fonts.mjs`、`scripts/font-files.mjs` | TTF 查找与下载；为 Keynote 安装演示文稿所用的字体 |
| 图库 | `scripts/gallery.mjs` | 960×540 的幻灯片图片（第一张是卡片封面），供应用的 `slide-templates/` 资源使用 |
| 字体 | `scripts/fonts.mjs`、`fonts/` | 以 WOFF2 加清单保存的 Google Fonts；TTF 文件按需下载，不纳入 git |
| 抓取 | `scripts/rip.mjs`、`rips/`（不提交） | Figma Community 预览幻灯片，用于测量来源 |

每个系统都以相同的字段绘制相同的类型，因此一份演示文稿可以在任何系统中渲染。[SKILL.md](SKILL.md) 是 Aeven 智能体为用户制作演示文稿时阅读的内容；下面的各节用于添加和维护模板。

## 设计系统

| 文件夹 | 模板 | 外观 | 来源 |
| --- | --- | --- | --- |
| `01-dark-pills` | Dark Pills | 海军蓝、粗重的窄体大写、紫罗兰色胶囊标签、“+”行 | Design Presentation Deck (Figma Community, CC BY 4.0) |
| `02-pastel-lineart` | Pastel Play | 青柠、淡紫和桃色色块、Poppins、圆形和六边形裁切 | Presentation Template with Yuppies Illustrations (Figma Community；重新绘制，不含源素材) |
| `04-agency-pitch` | Agency Pitch | 橙色活页夹卡片、窄体大写、镂空数字、有机色块 | Agency Pitch (Figma, CC BY 4.0) |
| `06-lush-lux` | Lush Lux | 轮换色块上的细体衬线大写 | Lush Lux (Figma, CC BY 4.0) |
| `07-bauhaus-mono` | Bauhaus Mono | 16×9 模块网格上的白、黑、灰，几何形状 | 原创 (Aeven) |
| `08-paper-pieces` | Paper Pieces | 剪纸形状、倾斜标题、打字机文字 | Paper Pieces (Figma, CC BY 4.0) |
| `05-bold-blobs` | Bold Blobs | 长春花蓝、黄色和绿色面板、粗重的窄体大写、手绘 3D 球体、醒目箭头 | Bold Blobs (Figma Community；重新绘制) |
| `09-brand-guidelines` | Brand Guidelines | 青柠与橄榄色块、大号斜体衬线、堆叠的大写标签块 | Brand Guidelines (Figma Community；重新绘制) |
| `10-clean-zine` | Clean Zine | 薄荷与棕色、窄体衬线大写、斜体板块标签、罗马数字 | Clean Zine (Figma Community；重新绘制) |
| `11-conference-talk` | Conference Talk | 蓝、橄榄和红色面板、黑色幻灯片、带衬线的怪诞体大写 | Conference Talk (Figma Community；重新绘制) |
| `12-design-portfolio` | Design Portfolio | 绿色棋盘格色带、等宽大写标题、绿色胶囊和条块 | Design Portfolio (Figma Community；重新绘制) |
| `13-mid-mod` | Mid Mod | 橄榄色标题色带、超宽粗重展示字体、天蓝、粉色和黄色块 | Mid Mod (Figma Community；重新绘制) |
| `14-startup-pitch` | Startup Pitch | 黄色封面、灰色页面、句首大写的标题、描边胶囊 | Startup Pitch (Figma Community；重新绘制) |
| `15-research-session` | Research Session | 黑色与鼠尾草绿、左下角大写标题、线描星形和光芒、打字机风格元信息 | User Research Session (Figma Community；重新绘制) |
| `16-customer-voice` | Customer Voice | 黑色报告页面、白色 Inter、粉彩彩虹条和圆环 | Voice of Customer Insights Report (Figma Community；重新绘制) |
| `17-project-review` | Project Review | 米色标题页、灰色线格网格、衬线大写、黑色页眉线 | Project Review (Figma Community；重新绘制) |
| `18-eigengrau` | Eigengrau | 近黑石板色页面、细体 IBM Plex Sans、虚线细线、粉彩条块 | Eigengrau (Figma Community；重新绘制) |
| `19-ux-showcase` | UX Showcase | 带浅色几何形状的电光蓝封面、白色案例页面、黑色页脚条 | Finessing UI/UX Design Presentation Template (Figma Community；重新绘制) |
| `20-marketing-strategy` | Marketing Strategy | 鼠尾草绿与薄荷色、细体窄衬线大写、带括号的编号、斜体数字 | Marketing Strategy (Figma Community；重新绘制) |
| `21-mobile-strategy` | Mobile Strategy | 带颗粒感的彩色渐变封面、白色页面、灰色卡片 | Mobile Product Review (Figma Community；重新绘制) |
| `22-product-review` | Product Review | 粗黑或米色框内的圆角面板，粗细混排的标题 | Product Review (Figma Community；重新绘制) |
| `23-product-roadmap` | Product Roadmap | 黑色封面、米色线格页面、大号指标行、等宽页眉 | Product Roadmap (Figma Community；重新绘制) |
| `24-research-readout` | Research Readout | 粉彩页面、竖向等宽导轨、彩色标签胶囊 | Research Readout (Figma Community；重新绘制) |
| `25-sales-pitch` | Sales Pitch | 带薄荷与绿色标题的黑色封面、灰色与薄荷色分割页面 | Sales Pitch (Figma Community；重新绘制) |
| `26-course-syllabus` | Course Syllabus | 炭灰色页面、细体衬线、每页一个彩色圆点 | University Course Syllabus (Figma Community；重新绘制) |
| `27-design-review` | Design Review | 黑、白、鼠尾草绿和橙色、细体大写、衬线标题色带、线格网格 | Design Review (Figma Community；重新绘制) |
| `03-blush` | Blush | 米色墙面与青色地面、粗体 Montserrat、插图位置放置抽象形状 | Presentation Template by Blush (Figma Community；重新绘制，不含插图) |
| `28-two-tone` | Two Tone | 酸性黄色带上方的灰色区域、巨大的 Inter 标题、带巨型数字的彩色面板 | Two Tone (Figma Community；重新绘制) |
| `29-chuckle` | Chuckle | 紫色、橙色和青柠色的代理提案、粗重窄体大写、倾斜贴纸、缺角边框 | Digital Agency Pitch Deck (Figma Community；重新绘制) |
| `30-night-shapes` | Night Shapes | 黑色幻灯片、宝蓝、醒目的橙色和黄色形状、红绿灯圆点 | Dark Themed Simple Slide Deck (Figma Community；根据其缩略图重新绘制) |
| `31-checkerboard` | Checkerboard | 纸色与炭灰色、棋盘格色块、青柠圆盘、紫色星号 | Minimalist Simple Slide Deck (Figma Community；根据其缩略图重新绘制) |
| `32-magazine` | Magazine | 严格的黑白、巨大的窄体标题、杂志式网格 | No.134 Magazine Style Slides (Figma Community；根据其缩略图重新绘制) |
| `33-pixel-quest` | Pixel Quest | 琥珀色与米色、像素画场景、游戏界面面板、像素字体 | Presentation Template Kit – Pixel Art Theme (Figma Community；根据其缩略图重新绘制) |
| `34-moodboard` | Moodboard | 白色与夜色页面、天空色块、全息丝带、渐变标题 | Mood – Moodboard Template (Figma Community；重新绘制) |
| `35-euclidean` | Euclidean | 暖米色、Source Serif、红色点缀、分割的细线布局 | Euclidean (Figma Community；重新绘制) |
| `36-folio` | Folio | 黑色作品集页面、巨大的紧排标题、珊瑚色和蓝色色块、紫罗兰光晕 | Folio Presentation Template (Figma Community；根据其缩略图重新绘制) |

没有 `layouts.mjs` 的文件夹是早期只含配色的测量结果，保留以供参考；渲染器会跳过它们并给出说明。

## 字体

只使用 Google Fonts，这样演示文稿在任何地方都渲染一致，字体也可以随附（SIL Open Font License 或 Apache）。

- 系统在 `type.fonts` 中指定字体族：`{ "text": "Inter", "display": "Inter Tight", "extra": ["Space Mono"] }`（`display` 和 `extra` 可选）。渲染器会拒绝没有 `type.fonts.text` 的系统。
- 如果 Google Fonts 有 Figma 来源使用的字体就直接使用；如果是商业字体，则按结构、x 高度和宽度选择最接近的 Google 字体族，并在 `type.fonts.source` 中记录原字体。
- `node scripts/fonts.mjs "<Family>"` 把 WOFF2（嵌入演示文稿）和 TTF（用于安装或 Office 嵌入）保存到 `fonts/<slug>/`；渲染器会在首次使用时保存缺失的字体族。提交 WOFF2 文件和清单；`*.ttf` 不纳入 git，需要时会再次下载。
- PPTX 按 Office 的方式命名每个字重（`Inter Tight ExtraBold`、`Inter` 粗体），并把这些 TTF 样式以 EOT 形式嵌入，因此 Windows 和 Mac 上的 PowerPoint 无需安装字体也能显示它们。Keynote 会忽略嵌入的字体：转换之前，导出器会把缺失字体族的 TTF 样式复制到 `~/Library/Application Support/Aeven/Fonts/` 并在 CoreText 中注册；如果 Keynote 没有打开的文档就会重启它，因为它只读取一次字体列表。
- 没有保存在 `fonts/` 中的字体族（发布的技能只随附 WOFF2）会从 Google Fonts 以 TTF 形式下载一次，保存到 `~/.cache/aeven-slides/fonts/`。

## 添加设计系统

一个系统就是一个文件夹 `systems/<NN-id>/`：

| 文件 | 内容 |
| --- | --- |
| `system.json` | `id`、`name`、`label`（模板的显示名称）、`type.fonts`、`palette` {paper, ink, muted, rule, onAccent, accents[3+]}，以及布局读取的其他令牌 |
| `layouts.mjs` | 返回样式表的 `css(system)`，以及 `slides`：每种类型一个函数 `(data, ctx) => '<section class="slide …">…</section>'`，另加 `frame({title, eyebrow}, ctx, body)`，即绘制 `chart` 和 `custom` 的带标题内容幻灯片 |
| `source.json` | `{figmaUrl, title, author, license}`，Aeven 设计则为 `{original: true, …}` |

`ctx` 提供 `esc()`（转义每一段文字）、`image(img)`（用户图片的 data URL，或 undefined：此时绘制占位图）、`chart(data)`（图表 SVG）、`index`、`total`、`deck` 和 `system`。渲染器提供幻灯片框（1280×720，溢出隐藏）、打印规则、字体声明、`--font` / `--display-font` 以及 `--avn-*` 配色变量，并会拒绝（附带原因）缺少某种类型、frame 或配色的系统。`systems/01-dark-pills/layouts.mjs` 是参考实现。

系统规则：
- 每种类型都要有，且字段与其他所有系统相同；只有样式不同。`chart` 和 `custom` 可以来自 `frame`。
- 紧跟来源：它的配色、字体、形状和元信息文字，不要凭空添加装饰。来源中没有某种类型的幻灯片时，设计一张明显属于这个系列的。
- 永远不要复制来源中的照片或插图；图片位置显示用户的图片，或以系统风格绘制的占位图。
- 可见文字要放在真实的文本节点中（而不是 `::before`/`::after`、SVG 文字或图片），否则 PPTX 无法让它可编辑。
- 权利：CC BY / CC0 来源可以紧密参照，并在 `source.json` 中注明作者；保留权利的来源只能作为宽松参考。

检查一个系统的方法：渲染它的示例演示文稿，用 `--strict` 导出 PDF，并把缩略图拼图与 `rips/` 中的来源帧对比（`magick montage p-*.png -tile 5x -geometry +3+3 sheet.png`）。

## 抓取 Figma 来源

`scripts/rip.mjs` 通过 DevTools Chrome（默认端口 9333）读取 Figma Community 文件的预览幻灯片，以 PNG 加 `meta.json` 的形式保存到 `rips/<name>/`；`rips/` 不提交。从这些 PNG 中测量配色和几何尺寸；永远不要随附它们。

## 发布到 Aeven

该技能作为 `aeven` 智能体预设的内置 `slides` 技能随 Aeven 应用一起发布，因此每个会话无需安装即可使用。`node scripts/publish.mjs`（或带上另一个 aeven 检出的路径）会打包导出器（`scripts/bundle.mjs` 写出包含 pptxgenjs、jszip 和 puppeteer-core 的 `dist/export.mjs`，因此随附的副本不需要 node_modules），并用 `SKILL.md`、脚本、每个可渲染的系统以及这些系统所用字体的 WOFF2 文件替换 `packages/preset/agent-presets/presets/aeven/skills/slides/`。模板外观改变时，用 `scripts/gallery.mjs` 重新生成图库图片，并复制到应用的 `apps/web/public/slide-templates/`。

## 权利

CC BY 4.0 或 CC0 下的来源会被紧密参照，并在每个 `source.json` 中注明；保留权利的来源只能作为宽松参考。本仓库和 Aeven 中都不随附来源照片、插图或抓取的帧；图片位置显示用户的图片或由系统绘制的占位图。字体是 SIL Open Font License 或 Apache 2.0 下的 Google Fonts。
