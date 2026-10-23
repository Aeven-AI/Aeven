---
description: "每次浏览器往返都会落到的 Æven 品牌页：居中的字标、贴合刚刚发生之事的一行说明，以及等待中的页面所用的标志与加载标记封面。"
kind: "package-reference"
---

# @aeven/brand-page

[English](README.md) | 中文

## 概述

`avn-brand-page` 负责读者离开应用外壳、完成一次浏览器往返（登录跳转、登录完成、连接器授权、账单回跳）后所看到的那一页。同一个渲染器为这些页面绘制即将上线页的字标组合：底色、颗粒质感与 Æven 字标，下面一行说明发生了什么，再下面一行更轻的字说明接下来该做什么。本包负责文档、样式表与字体；每个调用方负责自己的文案与响应头。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发者注记](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

### 何时使用

当一次请求返回的是供人阅读的页面，而不是重定向或机器可读的响应体时，就使用 `brandPageHtml`：提供方跳转、授权之后的落地页、支付之后的回跳。位于应用外壳内部的页面属于外壳，不属于本包。

### 入口

用一行结果文字渲染页面，可选地在下面再加一行指引：

```ts
import { brandPageHtml } from '@aeven/brand-page'

const page = brandPageHtml({
  note: 'Signed in.',
  hint: 'You can close this window.',
  title: 'Signed in — Æven',
})
```

即将离开的页面以等待状态渲染，并把去向交给文档，于是读者在浏览器离开之前看到的是封面：

```ts
import { brandPageHtml } from '@aeven/brand-page'

brandPageHtml({ state: 'waiting', note: 'Continuing to sign in…', redirect: 'https://example.com/continue' })
```

`scripted: false` 为不允许脚本的策略下的页面渲染同一套设计。此时样式表在入场动画上显示字标组合，而不是等待字体开关，并且既不输出重定向脚本，也不输出显示脚本。

### 选项

| 选项 | 作用 |
|---|---|
| `note` | 字标下方的一行：刚刚发生了什么。 |
| `hint` | 其下更轻的一行：读者接下来做什么。缺省则输出。 |
| `state` | `result`（默认）直接落在字标上；`waiting` 先显示标志与加载标记，再抬起封面。 |
| `title` | 标签页文字。默认为 `Æven`。 |
| `lang` | 文档的 `lang`。默认为 `en`。 |
| `redirect` | 有脚本的页面在完成绘制后立即前往的地址。 |
| `scripted` | 文档是否运行字体开关与重定向。默认为 `true`。 |

<a id="understand-the-implementation"></a>
## 理解实现

### 设计来自即将上线页

`BRAND_PAGE_CSS` 就是营销站将要上线页所用的样式表——同样的 `#f2f2f2` 底色、同样的湍流颗粒、同样的字标尺度（`clamp(3.25rem, 11vw, 10rem)`，字重 520）、同样的 `settle` 关键帧——只是再加上字标下方的两行文字，以及结果状态的时序。等待中的页面保留即将上线页的入场：字体就绪 780 毫秒后封面抬起，字标在 1000 毫秒时到场。

### 不发起任何请求

字体随模块一起发布（`assets/google-sans-flex-latin-wght-normal.woff2`），并以 data URI 内联进每一个文档，因此在不认识任何资源路由的本地回环端口上，字标依然用产品自己的字体排版。标签页图标同理，也是内联的 data URI。渲染出的页面不会自行打开任何连接。

### 字体开关，以及不能运行它的页面

有脚本的页面在首次绘制前把自己标记为 `fonts-loading`，并在 `document.fonts.load` 解析出字标组合所需的两个字重之后切换为 `fonts-ready`，预算为 3.5 秒。这次切换正是入场的起点，因此任何字形都不会先用回退字体绘制。不允许脚本的策略下的页面两个类都不带；样式表的静止状态是只有文字、没有封面，入场动画挂在 `:not(.fonts-loading)` 上，因此随加载运行。

### 部署端保留一份副本

Aeven API 的连接器页与账单页用的是这份设计的 CommonJS 副本。`src/page.ts` 中 `// <brand-page-css>` 标记之间的样式表是权威来源；该仓库的 `scripts/brand-page-css.mjs --check` 会在副本漂移时失败，当其旁边存在 harness 检出时，其单元测试会执行该检查。

<a id="further-exploration"></a>
## 延伸阅读

- [Web 能力组](../../client/README.zh.md)，了解这些页面所在外壳之外的组件。
- [docs/architecture.md](../../../docs/architecture.zh.md)，了解宿主包在组合中的位置。

<a id="dev-note"></a>
## 开发备注

本包不发布运行时不变式伴随模块：页面只是对其参数的纯渲染，包本身既不持有持久事件流，也没有可独立观察的关系可供断言。

### 测试

`tests/brand-page.spec.ts` 固定两种状态、无脚本形式、转义以及样式表声明的设计。调用方固定各自的文案：桌面登录页、Web 应用登录页与 Slack 回环页都断言类名、文案与内联字体。

<a id="model-experience"></a>
## 模型体验

### 不面向模型

#### 模型看到什么

没有。`brandPageHtml` 渲染供浏览器阅读的文档——登录跳转、登录完成、连接器授权、账单回跳——不注册提示词分节、工具、会话事件或结果。

#### Token 影响

没有。任何渲染出的页面都不会进入模型请求，因此 `brandPageHtml` 的页面不贡献 token。

#### KV Cache 影响

没有。此处没有任何内容进入请求前缀，因此提供方缓存复用不受影响。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

- 文案属于调用方，也使用调用方的语言：部署端的连接器页自带中英文对照表，harness 的页面则从各自的本地化传入手写文案。本包不做任何翻译。
- 字体只覆盖拉丁字符，因此中文的 `note` 会回退到系统中日韩字体，而字标仍使用 Google Sans Flex。
- 部署端是样式表的第二份物理副本。两者被比较而非共享，因为两个仓库独立构建。
