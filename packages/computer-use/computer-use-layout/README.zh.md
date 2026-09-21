---
description: "把幻灯片布局作为纯几何：由网格计算得出的参数化布局，无需应用程序，也无需任何工具。"
kind: "package-reference"
---

# @aeven/computer-use-layout

[English](README.md) | 中文

## 概述

七个由声明式网格计算得出的参数化幻灯片布局。取自 Codex 应用程序随包提供的配方目录——41 个幻灯片布局，每个都是在声明式绘图 API 之上的参数化 `run`，坐标由 12 列网格推导而来，而不是通过观察屏幕发现。

值得借鉴的结构性想法是：**布局是纯几何**。配方接收参数并返回已定位的形状。它不接触任何应用程序，也不需要任何工具，因此本模块刻意不含 I/O。把结果渲染为文件是另一件独立的事，有自己的就绪要求；把两者分开，正是让真正有趣的部分**在任何机器上**都可校验的原因——包括本机，在这里它是整个技术栈中唯一无需安装任何东西即可运行的能力。

这也是对格式问题的回答。一个通过**计算出的几何**来校验的参数化布局，严格优于通过像素校验的操作序列，因为一个溢出幻灯片的形状无论截图显示什么都是错的。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [已知限制与后续工作](#known-limited-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

```ts
import { layoutDeck, overflowing, overlapping } from '@aeven/computer-use-layout'

const deck = layoutDeck([
  { kind: 'cover', title: 'The Cartographer of Small Hours', subtitle: 'A short story' },
  { kind: 'bullets', title: 'Agenda', items: ['Vell', 'The stopped clock', 'Two times'] },
  { kind: 'metrics', title: 'Traction', metrics: [{ value: '4.2M', label: 'Revenue' }] },
])

overflowing(deck[0]!)   // [] — no shape falls outside the slide
overlapping(deck[1]!)   // role pairs that coincide, which the caller judges
```

<a id="understand-the-implementation"></a>
## 理解实现

### 网格是声明的，而不是按布局硬编码的

`DEFAULT_GRID` 固定了 12 列、80 单位边距，以及为 8 的倍数的间隙，其取值使它们能整除 1366×768 的画布。每个布局都相对它定位，这使一份演示文稿内部保持一致，并让布局无需细读即可被推理：整宽形状就是内容宽度，而 `spanWidth(grid, 4)` 在每个配方中都是同一个值。

`snap()` 会向基准单位取整，因此形状的边缘是测试可以精确陈述的值，而不是必须容忍的浮点数。

### 校验是几何，而不是像素

`overflowing()` 报告落在画布之外的形状，这是关于计算结果的事实。`overlapping()` 报告重合的角色对而**不予评判**，因为重合有时正是设计本身——标题色带刻意覆盖在背景之上——因此由调用方决定哪些角色可以合理地重合。

这一区分正是本层值得存在的原因：通过像素校验的操作序列无法确立"没有任何东西溢出"，而一份正确演示文稿的截图，与一份宽出一个单位的演示文稿的截图看起来完全相同。

### 填色是参数，因此演示文稿重设样式无需改动布局

`LayoutFills` 只解析一次且完全必需，因此读取 `fills.accent` 的布局总能拿到字符串，而不必在每个使用点自行发明兜底值。传入 `{ fills: { band: 'slate-900' } }` 会改变色带，其余保持默认。

<a id="further-exploration"></a>
## 延伸阅读

- [`@aeven/computer-use-formats`](../computer-use-formats/README.zh.md) —— 把布局渲染为文件，工具要求就在那里。
- [`computer-use-source-inventory.md`](../../../../workspace/project/computer-use-source-inventory.md) —— 为何该能力取自 Codex，而不是从某个仓库重新实现。

<a id="known-limited-work"></a>
## 已知限制与后续工作

- **七个布局，而不是四十一个。** 目录中有 41 个幻灯片布局，包括一套十一个配方的路演稿；这里是七种具有不同几何结构的类型，其余是它们的参数化变体。
- **没有渲染器。** 本包计算几何后即止。把它写入演示文稿文件需要 `python-pptx`，而它在本机被阻塞，因此目前还无法在此产出演示文稿。
- **`agenda` 就是 `bullets`。** 目录将它们分开提供且样式不同；这里只有几何不同，因此在渲染器能表达该差异之前它们共用一个布局。
- **没有图表布局。** 目录中的 `chartStyle` 与 `chartType` 配方是另一件事——它们为绘图 API 产出的图表设定样式，而那需要该 API。
- **没有任何东西回读演示文稿。** 布局由其自身几何来校验；确认渲染出的文件实际包含什么，需要格式层的读取器。

<a id="dev-note"></a>
## 开发备注

`exactOptionalPropertyTypes` 在此发现了一处真实的松散之处：解析后的填色是 `string | undefined`，这会迫使每个布局为 `resolve()` 总会提供的值发明兜底。现在的类型表明，已解析的选项就是已解析的。

编写测试还发现了第二件值得记录的事。有两个辅助函数名被导入，却从未被实现，而测试套件仍然通过了——vitest 不做类型检查。这两个名字已被移除，并直接核对导出与导入，因为一次绿色的运行并不能证明代码引用了任何东西。

**运行时不变式：** 不发布伴随插件，因为本包以纯函数从规格计算幻灯片几何，其输出是全定义的，并可按值比较；这里不存在可观察的效应序列。
