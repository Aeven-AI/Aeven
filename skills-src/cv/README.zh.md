# Aeven CV

[English](README.md) | 中文

简历设计系统，以及把任一系统填入某个人自己内容的生成器，位于 aeven 仓库的 `skills-src/cv`，旁边是 `skills-src/slides`；`scripts/publish.mjs` 把 Aeven 随附的副本写入 `packages/preset/agent-presets/presets/aeven/skills/cv`。HTML 是源文件；PDF、DOCX 和 Pages 由它导出。

```sh
pnpm install --ignore-workspace                # its own dependencies, outside the harness workspace
node scripts/render.mjs black out              # a system's sample CV → out/cv-black.html
node scripts/render.mjs my-cv.json out          # a person's CV in the system it names → out/my-cv.html
node scripts/export.mjs out/cv-black.html out   # → PDF, DOCX, Pages (pdf,docx,pages to choose)
node scripts/gallery.mjs out/gallery            # page pictures for the Aeven Resumes gallery
node scripts/publish.mjs                        # ship the skill into this checkout
```

## 各部分如何组合

| 部分 | 文件 | 内容 |
| --- | --- | --- |
| 共享区块 | `scripts/blocks.mjs` | 内容标记（条目、列表、技能、语言、联系方式）、侧栏与主栏的划分，以及系统 05–40 所基于的页面外壳 |
| 原型 | `scripts/kit.mjs` | 侧栏、标签列和堆叠式简历布局及其页眉部件，供系统 15–40 使用 |
| 内容模型 | `scripts/cv.mjs` | 简历字段和板块类型、校验，以及图库的示例简历 |
| 图标 | `scripts/icons.mjs` | 时间线条目的线性图标 |
| 设计系统 | `systems/<NN-id>/` | `system.json`（字体、配色）、`layouts.mjs`（样式表和页面）、`source.json`（来源） |
| 渲染器 | `scripts/render.mjs` | 简历 + 系统 → 内嵌字体和照片的独立 A4 HTML；分页在页面内运行 |
| 导出器 | `scripts/export.mjs` | HTML → PDF（Chrome）、DOCX（`scripts/docx.mjs`）、Pages；页数和溢出警告 |
| Office 字体 | `scripts/office-fonts.mjs` | 每个字重对应的 Office 字体名称（“Oswald Light”） |
| 已安装字体 | `scripts/installed-fonts.mjs`、`scripts/font-files.mjs` | TTF 查找与下载；为 Pages 安装简历所用的字体 |
| 图库 | `scripts/gallery.mjs` | 794×1123 的页面图片（第一张是卡片封面），供应用的 `cv-templates/` 资源使用 |
| 示例 | `samples/` | 示例简历的照片 |
| 字体 | `scripts/fonts.mjs`、`fonts/` | 以 WOFF2 加清单保存的 Google Fonts；TTF 文件按需下载，不纳入 git |

[SKILL.md](SKILL.md) 是 Aeven 智能体为某人制作简历时阅读的内容。

## 设计系统

| 文件夹 | 模板 | 外观 | 来源 |
| --- | --- | --- | --- |
| `01-black` | Black | 黑色与炭灰色色带、绿色姓名块、整页人像封面、Oswald 大写、技能环、图标时间线 | Mee Resume, Black + Green (ThemeZaa)；根据其 860px 宽的演示以 A4 纵向重新绘制 |
| `02-white` | White | Black 布局的白色、浅灰与黄色版本，带黑色侧栏 | Mee Resume, White + Yellow (ThemeZaa)；重新绘制 |
| `03-slate` | Slate | 深石板色与薄荷色、粗重的 Poppins 标题、姓名位于上升圆形中的照片封面、竖排时间线日期、技能条、圆点评级的语言 | Myour, index-3 (bslthemes)；根据其 860px 宽的演示以 A4 纵向重新绘制 |
| `04-fresh` | Fresh | 白色与清新绿色、Montserrat 标题、照片融入倾斜薄荷色形状的主视觉、带框的 About 照片、阴影卡片、计数器、标签 | Martyn (bestwebcreator)；根据其 860px 宽的演示以 A4 纵向重新绘制 |
| `05-classic` | Classic | 白色 A4、顶部黑色细线、粗体姓名、黄色圆环上的圆形照片、安静的双栏 | CV / Resume (Alexis Riols), Figma Community, CC BY 4.0；重新绘制 |
| `06-glow` | Glow | 暖色纸张上带颗粒感的橙色光晕、宽幅 Unbounded 标题、编号的板块分隔线 | CV Resume Template (Katerina Pavlova), Figma Community, CC BY 4.0；重新绘制 |
| `07-forest` | Forest | 深绿色侧栏，带圆形照片和白色技能条 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `08-blobs` | Blobs | 粉色、绿色和青色色块，照片位于色块中，大写大号姓名 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `09-pulse` | Pulse | 蓝到洋红的边框、玻璃质感侧卡、标签页签、技能环 | CV/Resume (Jay Patel), Figma Community, CC BY 4.0；重新绘制 |
| `10-portfolio` | Portfolio | 炭灰色 Poppins 页面、错位照片框、渐变圆环和卡片 | Personal Portfolio / CV (UXM), Figma Community, CC BY 4.0；重新绘制 |
| `11-sage` | Sage | 鼠尾草绿页眉色带，带衬线体问候语和黑白人像 | Product & UX Designer Resume (Pixelzudio), Figma Community, CC BY 4.0；重新绘制 |
| `12-contrast` | Contrast | 灰色纸张、黄色块上的黑白人像、字距加宽的大写姓名、黄色时间线 | CV/Resume (Israel Betolaza), Figma Community, CC BY 4.0；重新绘制 |
| `13-magic` | Magic | 极光下的近黑色页面、渐变圆环头像、紧凑的板块 | Magic Resume (Once UI), Figma Community, CC BY 4.0；重新绘制 |
| `14-gridfolio` | Gridfolio | 米色页面、带大照片的白色圆角资料卡、橙色标题 | Designer Resume – Gridfolio (Matteo Tiscia), Figma Community, CC BY 4.0；重新绘制 |
| `15-tang` | Tang | 细线上方的巨大大写姓名、带下划线的大写标题、黑色技能条、无照片 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `16-sunbeam` | Sunbeam | 白色页面，照片和姓名位于左上，右侧是阳光般黄到蓝的渐变侧栏 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `17-noirband` | Noir Band | 黑色页眉色带，居中的圆形照片和联系方式一行，下方是两栏清晰内容 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `18-confetti` | Confetti | 散落的粉彩纸屑中居中的圆形照片、编号的板块标签和柔和的灰色标签 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `19-mintmist` | Mint Mist | 大号引言后方的薄荷与柠檬光晕、标签列布局、照片位于左上 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `20-serifbold` | Serif Bold | 圆形照片旁的巨大黑色衬线姓名，安静左栏中的小型大写标签 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `21-bluewash` | Bluewash | 宝蓝色姓名，角落里的海军蓝与桃色纸片形状，干净的右侧栏 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `22-minimalrule` | Minimal Rule | 细线上方的方形照片和姓名、字距加宽的大写标签，一切都在严格的网格上 | Resume / CV Templates (Lina), Figma Community, CC BY 4.0；重新绘制 |
| `23-supa` | Supa | 现代卡片式简历：浅色侧栏中的大号圆角照片、按颜色区分的联系方式、以带图标块的卡片呈现的条目 | Supa Resume - Light & Dark (Angelo Libero), Figma Community, CC BY 4.0；重新绘制 |
| `24-supa-dark` | Supa Dark | 深夜海军蓝底色、紫罗兰点缀的 Supa 卡片式简历 | Supa Resume - Light & Dark (Angelo Libero), Figma Community, CC BY 4.0；重新绘制 |
| `25-marina` | Marina | 电光蓝边缘配粉色和黄色菱形、粗体 Space Grotesk、粉色方格纸上的技能 | Minimal CV/Resume template 1.0 (Marina), Figma Community, CC BY 4.0；重新绘制 |
| `26-judit` | Judit | 暖象牙色页面、衬线姓名与珊瑚色点缀、圆形照片和整齐的细线板块 | CV / Resume Template (Judit Salvadó), Figma Community, CC BY 4.0；重新绘制 |
| `27-monica` | Mónica | 天蓝色顶边、带蓝色副标题的姓名、右侧圆形照片、带字距加宽大写标签的两栏 | CV / Resume Figma Template (Community) (Mónica Fidalgo), Figma Community, CC BY 4.0；重新绘制 |
| `28-sunny` | Sunny | 醒目的黄色页眉和大号问候语、拱形中的照片、粉色标签和活泼的字体 | Resume CV Templates (Yoka leis), Figma Community, CC BY 4.0；重新绘制 |
| `29-javorkai` | Javorkai | 瑞士风格 A4：大号姓名、方形照片、沿页边竖排的板块标签、日期独占一列 | Resume & Cover Letter template (Peter Javorkai), Figma Community, CC BY 4.0；重新绘制 |
| `30-khalil` | Khalil | 带黄色点缀的炭灰色页面、带圆环的圆形照片和柔和的侧卡 | Modern & Clean Resume | CV Templates (Khalil Boukhelifa), Figma Community, CC BY 4.0；重新绘制 |
| `31-ember` | Ember | Khalil 布局的明黄色版本，白色侧卡和黑色文字 | Modern & Clean Resume | CV Templates (Khalil Boukhelifa), Figma Community, CC BY 4.0；重新绘制 |
| `32-harvard` | Harvard | 经典学术简历：居中的衬线姓名、通栏细线、右对齐的地点和日期、无照片 | Harvard Academic Resume / CV Template (Figma Community), Figma Community, CC BY 4.0；重新绘制 |
| `33-kit` | Kit | 柔和薰衣草色边框上的白色圆角纸张、小号圆角照片、紫罗兰色职位和标签列 | UI/UX Designer Resume / CV Kit (Figma Community), Figma Community, CC BY 4.0；重新绘制 |
| `34-kit-dark` | Kit Dark | Kit 纸张的深色模式：靛蓝边框上的炭灰色卡片 | UI/UX Designer Resume / CV Kit (Figma Community), Figma Community, CC BY 4.0；重新绘制 |
| `35-six` | Six | 浅蓝色侧栏和页眉、方形照片、Work Sans 粉色板块标题 | 6 Free Resume Templates (Figma Community), Figma Community, CC BY 4.0；重新绘制 |
| `36-pills` | Pills | 每个板块都是浅灰底上的白色卡片，带彩色胶囊标题；友好的现代布局 | +60 Resume/CV Templates (Figma Community), Figma Community, CC BY 4.0；重新绘制 |
| `37-aurora` | Aurora | 粉到淡紫的渐变页眉，带圆形照片和链接标签，下方是平静的标签列 | Resume (Enji Kusnadi), Figma Community, CC BY 4.0；重新绘制 |
| `38-aurora-dark` | Aurora Dark | 夜间版 Aurora 布局：洋红与紫罗兰光晕下的海军蓝页面 | Resume (Enji Kusnadi), Figma Community, CC BY 4.0；重新绘制 |
| `39-resumate` | Resumate | 带黑色斜角和柔和粉色光晕的白色页面，蓝色姓名和板块标题 | Resumate - FREE Resume/CV Template Pack (Reyhan Tamang), Figma Community, CC BY 4.0；重新绘制 |
| `40-brix` | Brix | 干净的 Manrope 简历：圆角照片、紫罗兰色职位、联系方式标签、左栏中的日期和紫罗兰色板块条 | CV / Resume Templates | BRIX Templates (BRIX Templates), Figma Community, CC BY 4.0；重新绘制 |

系统的 `layouts.mjs` 导出 `css(system)` 和 `pages(cv, ctx)`，返回包含所有区块的开头页面和一个空的续页。区块带有 `data-block`；当某一栏溢出时，渲染器的分页会把整个区块移到下一页，让带 `data-keep` 的标题与其第一个条目保持在一起，并把某一栏的空白尾部赋予其最后一个区块的 `data-band`。只有第 1 页带有姓名块或页眉；任何页面都不带菜单或页码，因为导出的页面要像一页连续滚动的内容那样阅读。配色以 `--c-<name>` 的形式进入样式表；White 复用 Black 的布局并使用自己的配色。system.json 中某个系统的 `sample` 会覆盖共享示例简历的字段，因此每个模板的图库都展示自己的人物（见 `cv.mjs` 中的 `sampleFor`）。

## 导出

- **PDF**：Chrome 打印分页后的 HTML，A4，包含背景。
- **DOCX**：每一页都是隐藏文字后的页面 JPEG，浮于页面后方，上面按 Chrome 使用的位置、字体、字号、字重、颜色和字距，为每一行放一个 DrawingML 文本框。字体会被嵌入。之所以用文本框而不用带框段落：展示字体需要比紧凑标题行距更高的行框，因此行会重叠，而 Pages 会丢弃重叠的带框段落中的文字。
- **Pages**：安装简历所用的字体后，Pages 打开 DOCX 并保存（需要装有 Pages 的 macOS）；工作区沙箱会拒绝这两步，导出器会打印需要在沙箱外运行的命令。

## 示例照片

`samples/model-<id>.jpg` 是来自 Unsplash 的编辑类人像，采用 Unsplash License（id 即 Unsplash 照片 id）；system.json 中每个系统的 `sample` 会选用其中一张。
