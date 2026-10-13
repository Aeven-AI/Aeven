# Agent Note: Aeven web visual language

Status: implemented

[English](2026-09-03-aeven-web-visual-language.md) | 中文

## Problem

Web 客户端原先使用蓝色调的导航与消息表面、紧凑的 14px 会话文本、多套互不关联的圆角、920px 自适应阅读上限和带层级投影的 composer。Aeven 客户端采用更温暖、安静的体系：可变字重排版、`rgb(242, 242, 242)` 画布、白色内容表面、30px 主圆角、40px 控件、桌面 24px 边距、移动端 16px 边距、1024px 阅读栏和扁平 composer。把这些值复制进每个 CSS Module，会使后续调整再次依赖跨 package 扫描。

## Decision

`packages/client/ui-theme/src/styles/aeven-language.css` 是生成的平台与排版样式表之后的最终产品语言层。它持有 `--dsw-aeven-*` 几何与间距变量，并把现有语义颜色和排版别名映射到 Aeven 值。组件 CSS 使用这些共享变量定义对话宽度、页面边距、间距、控件尺寸、表面圆角、内容/控件圆角与阅读行高。应用 entry 自托管 Google Sans Flex 和 Google Sans Code 可变字体文件（SIL OFL，latin 子集）；现有系统字体栈继续作为回退。字体是 Web 客户端唯一偏离参考客户端之处，后者使用 Geist。

Conversation、sidebar、workspace 行、settings 和共享 primitive 采用集中变量。对话栏与 composer 均以 1024px 为上限，用户气泡与 composer 使用 30px 白色表面，composer 没有边框或层级投影，控件使用共享的 40px/20px 几何，Markdown 使用参考中的标题、段落、列表、分隔线、行内代码与代码块节奏。侧栏使用参考中的 280px 半透明面板、20px 右上圆角、整行 40px 高度、桌面 24px 与移动端 16px 行内边距、桌面 40px 底部内边距、扁平 hover 与选中状态，以及 400ms easing。12–17px 用户字号设置仍是权威，并通过现有增量变量移动 Aeven 排版阶梯。

客户端保留插件布局、sidebar 席位、视图 tab、details 面板、settings 信息架构、深色偏好，以及功能操作与状态图标。侧栏遵循参考交互：其布局栏收起到零宽度，所有菜单内容消失，左上角保留 68×40px hamburger 按钮；展开开关增加参考中的双左箭头。深色模式通过同一别名表把 Aeven 中性层级适配到深色表面；功能组件仍不包含主题选择器。第三方主题继续在注册后覆盖语义别名。

本决策只取代[Web 样式系统笔记](2026-07-19-web-styling-system.zh.md)中的视觉基线值、[共享 composer 宽度笔记](../feature/2026-08-04-web-composer-shared-width-axis.zh.md)中的默认宽度关系、[层级投影笔记](../feature/2026-09-01-web-elevation-stroke-shadows.zh.md)中的 composer 投影。这些笔记关于框架、交互与浏览器渲染的依据仍然有效。

## Alternatives considered

**完整复制参考 CSS 结构与组件 markup。** 否决，因为这会替换 B 的插件席位、sidebar、settings、交互状态与图标，而不是只改变其视觉语言。

**在每个组件模块中直接写入 Aeven 数值。** 否决，因为同一圆角、控件、宽度与边距决策会有多个所有方。最终的主题变量层让这些常量只有一个编辑点，同时各模块保留局部布局规则。

**用参考图标集替换 B 的全部图标。** 否决，因为功能图标身份属于 B 的产品行为。只有侧栏开关使用菜单交互要求的参考 hamburger 与双左箭头。

**因参考只有浅色而删除深色模式。** 否决，因为 B 已提供持久化主题偏好。中性的深色映射保留该能力，不改变浅色参考目标。

## Consequences

浅色客户端遵循 Aeven 视觉层级，同时仍可识别为 harness 且保持可操作。几何值可从 `aeven-language.css` 调整；共享常量不再要求跨组件协调修改字面量。关闭侧栏会把完整视口宽度交给会话区且不保留图标轨道；用户从叠加的 hamburger 重新打开它。新增字体资源使应用 payload 在压缩前增加约 53KB。用户选择的字号和拖动后的对话宽度仍可偏离基线。部分密集工具与状态行保留紧凑的局部几何，因为放大所有操作行会降低 transcript 扫读效率，并改变已建立的交互占位。
