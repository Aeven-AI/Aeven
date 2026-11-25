# Agent Note：长轮次丢失已创建文件块，HTML 预览无法运行 ES 模块

Status: implemented

[English](2026-11-25-produced-files-for-paged-turns.md) | 中文

## 问题

2026-11-25，会话 `session-45df5e4a…` 在 `~/Documents/Aeven/vase-reassembly` 中构建了一个 three.js 页面。整个会话只有一个轮次：seq 5 处一个 `turn/start`，seq 213306 处 `turn/end`，运行期间插入了 25 条人类消息，日志共 7 MB。全程观看运行的桌面窗口显示了已创建文件块；在 chat.aeven.io、localhost:3080 或重新加载的桌面窗口中打开同一会话则没有。follow 快照只携带最后 50 条消息，因此客户端持有该轮次的收尾消息，却没有它的 `turn/start`。客户端 `deliverables` Definition 从 `turn/start` 开始，所以在把所有更早的页面滚动载入之前，该轮次没有产出文件数据。

同一次运行还暴露了另外两个缺陷。它的交付物 `porcelain-reassembly.html` 由 `node build.mjs` 写出：该命令没有声明 `output_files`，`output_files` 的描述只列出 PDF、DOCX、表格和图片而没有构建出的页面，未声明输出的检测也不关注 HTML。Files 窗格对 `index.html` 的预览没有画出场景：它只内联经典脚本，因此页面的 import map 和 `./src/*.js` 模块图无法在不透明源的 frame 中加载，而且预览基于文本视图有上限的那一页构建。

## 决定

- `@aeven/session-turn-outline` 注册第二个单元 `turnDeliverables`：从整份日志折叠出每个轮次的产出文件，按轮次以路径和声明方式折叠。折叠使用 `src/produced.ts` 中的读取函数，`./client` 导出它们，客户端 `deliverables` Definition 现在也导入它们，因此 Host 与客户端列出相同的文件。
- 对 `turn/start` 未载入且 Definition 没有数据的轮次，轮次尾部选择器仍会认领；`ProducedFiles` 随后通过 `useProjection('turnDeliverables')` 读取该轮次的条目，正文提及与链接解析器经 `ctx.get('sessions')` 读取同一个值。已载入的轮次保留 Definition 的精确数据。
- `output_files` 描述加入了构建出的 HTML 页面，`html`/`htm` 加入 `detectOutputExtensions`，因此提到 `.html` 路径的命令会记录它。
- 预览会内联页面的工作区 ES 模块：经相对导入或页面 import map 到达的每个模块都成为生成的 import map 下的一个 `data:` URL，每个说明符都改写为该映射的键。说明符由 `es-module-lexer` 的 asm.js 构建查找。预览读取页面本身的字节，而不是有上限的文本页。
- 运行时上下文以及 CV 和演示文稿技能要求模型把它创建的文件保存在会话工作区中，每项工作一个文件夹；Aeven 文件夹那一行只说明哪个文件夹会同步。上述会话的工作区是 Aeven 仓库，却被要求保存到 `~/Documents/Aeven`，因此 Files 树从未显示它的成果。没有自己文件夹的会话在 `~/Documents/Aeven/chats` 中工作，因此它的文件仍会同步。
- Files 窗格打开文件时不再显示“不在工作区内”提示，文本读取也去掉了该提示唯一使用的 `outsideWorkspace` 字段。
- 打开文件时先复用只显示目录树的 Files 标签，再考虑新增。标签在重新加载后保留，而每个标签显示的文件只存在于浏览器内存中，因此每次重新加载后再打开文件都会多出一个标签。

## 考虑过的替代方案

- **把首屏页向前扩展到被截断轮次的 `turn/start`。** 否决：对这个会话而言，打开时就要载入整份 7 MB 日志。
- **每个历史页都附带被截断轮次的前缀折叠结果。** 否决：这会给 follow 快照和每个页面增加 wire 字段，assembler 还需要预置起点；投影注册表已经负责整日志折叠的投递、缓存与实时更新。
- **即使命令没有提到，也在命令所在文件夹中关注 HTML。** 否决：CV 技能在一条命令中渲染 `cv.html`，在下一条命令中导出 PDF、Word 和 Pages，它的中间页面会与这些文档并列显示。
- **把每个模块的依赖作为 `data:` URL 嵌套进它自己的 `data:` URL。** 否决：像 three.js 这样被六个模块导入的模块会被嵌入六次，每一层还有 base64 膨胀。

## 影响

长轮次的已创建文件块在每台设备上、每次重新加载后都会出现，代价是多一个在修改结果落地时推送的整值投影；本地的重度会话不足 200 个条目。构建脚本写出 HTML 交付物而命令中没有提到它时，只有模型把它列进 `output_files` 才会被记录。运行时去读取工作区文件、或用 `import.meta.url` 拼出模块 URL 的页面，在沙箱预览中仍然无法访问这些文件。
