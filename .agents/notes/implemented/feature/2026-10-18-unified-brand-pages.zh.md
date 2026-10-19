# Agent Note: every browser round trip lands on the brand page

Status: implemented

[English](2026-10-18-unified-brand-pages.md) | 中文

## 问题

读者离开应用外壳——用第三方登录、授权连接器、为套餐结账——再回来时会经过产品自己提供的页面，而这些页面看起来像不同的产品。部署端为连接器结果画的是系统字体的卡片配一个 ✓ 或 `!`，账单回跳是一行白色的字标，社交登录则继承了那个粉色的「Please close this window」页。harness 给 Web 应用登录画的是纯文本 `Signed in. You can close this window.`，Slack 授权是一个裸 `<p>`，xAI 回环则用自己的系统字体标题。它们没有共享任何样式表、字体或语气，也没有与产品真正呈现的即将上线页保持一致。

## 决定

一个设计接管全部这些页面：`@aeven/brand-page` 渲染即将上线页的字标组合——`#f2f2f2` 底色、湍流颗粒、`clamp(3.25rem, 11vw, 10rem)` 字重 520 的 Æven 字标、`settle` 入场——下面一行说明发生了什么，再一行更轻的字说明接下来做什么。

### 两种状态，一份样式表

`state: 'waiting'` 是即将离开的页面：标志与加载标记遮住字标组合，直到字体就绪，随后封面抬起、字标到场。`state: 'result'` 没有封面，直接落在字标上。等待中的页面是提供方跳转（桌面登录、`avn` 无头登录）；结果页是每一个已完成的结果。

### 字体随页面一起传递

样式表里的 `@font-face` 以 data URI 交付：woff2 位于本包的 `assets/` 目录，`brandPageHtml` 将其内联。一个不提供任何资源路由的任意端口的回环监听器，依然能用产品自己的字体排版字标，而文档不会自行打开任何连接。标签页图标同理，也是内联的 data URI。

### 无法运行脚本的页面渲染同一套设计

部署端的回调在 `default-src 'none'` 下应答，因此它的页面完全不带脚本：样式表的静止状态就是只有文字、没有封面，入场动画挂在 `:not(.fonts-loading)` 上，因此随加载运行。harness 的页面则带字体开关——首次绘制前为 `fonts-loading`，`document.fonts.load` 解析后为 `fonts-ready`——因此任何字形都不会先用回退字体绘制。

### 部署端保留一份被比较的副本

Aeven API 是独立构建的另一个仓库，因此它携带渲染器与样式表的 CommonJS 副本：`services/pages/brandPage.js`。`packages/util/brand-page/src/page.ts` 中 `// <brand-page-css>` 标记之间的样式表是权威来源；该仓库的 `scripts/brand-page-css.mjs --check` 会在副本漂移时失败，当其旁边存在 harness 检出时，其单元测试会执行该检查。

### 采用这套设计的页面

| 页面 | 状态 | 文案 |
|---|---|---|
| 桌面提供方登录起始页 | waiting | 外壳自己的本地化标签 |
| 桌面提供方登录落地页 | result | 外壳自己的本地化标签 |
| `avn web` 无头登录起始页 | waiting | `Continuing to sign in…` |
| `avn web` 无头登录落地页 | result | `Signed in.` |
| Slack 回环落地页 | result | 宿主自己的句子 |
| xAI 回环落地页 | result | `Signed in.` / `Sign-in failed.` |
| 连接器授权回调 | result | 部署端的中英文结果表 |
| Stripe 回跳 | result | 部署端的中英文账单表 |

## 考虑过的替代方案

**保留各页自己的标记，只把颜色抄过去。** 否决：这正是形成八个页面、四种字体的那种安排，而且此后任何设计改动都要跨两个仓库改八处，且没有任何机制能发现漏掉的一处。

**让部署端通过共享 URL 从 harness 包取页面。** 否决：部署端在公网上应答，有自己的 CSP、缓存策略与在线率要求；依赖另一个服务可达的页面，就是会在事故期间失效的页面。

**等待状态复用应用外壳的 `#avn-preloader`。** 否决：外壳的预加载器是为即将变成应用的文档做的首屏封面，由客户端 bundle 提供样式并跟随系统配色。这些页面本身就是文档，位于纯色底上，并且必须在不加载任何 bundle 的情况下渲染。

**把字体留在监听器提供的路由后面（桌面原先的 `/fonts/...` 处理器）。** 否决：这些监听器中只有一部分能拿到字体文件——harness 的 Slack 与 xAI 回环不拥有任何资源——同一套设计就需要两种字体答案。内联一个 120 KB 字体比它替代的路由少一次请求。

## 后果

外壳之外的每个页面现在都与访客最初见到的页面读作同一个产品，设计改动有了一个权威来源而不是八份副本。本包为 harness 的每个回环响应增加 120 KB 字体，这些响应由一台机器上的一位读者读一次；部署端继续使用自己的 `/fonts` 副本，不承担这份成本。

部署端是真正的第二份副本。它被比较而非共享，且比较从部署端自己的测试套件运行，因此 harness 的改动若忘记同步副本，会出现在该仓库的测试里，而不是读者的浏览器里。

连接器页保留中英文结果表，因此中文读者会在拉丁字标之下看到中文结果，而中文回退到系统日韩字体——这与即将上线页以及客户端的行为一致。

继承来的 `templates/oauth.marko`——一个粉色「Yello - Sign in」页面，已无任何路由渲染——与 `templates/billing-return.marko` 一并随账单路由的 Marko 渲染删除。

## 测试

`packages/util/brand-page/tests/brand-page.spec.ts` 固定两种状态、无脚本形式、转义以及样式表声明的设计。桌面登录页、Web 应用登录页（其 host、flow 与 server-contract 套件）、Slack 登录套件、部署端的 `brandPage.test.js` 与其连接器回调套件覆盖各调用方的文案、类名、策略响应头，以及——对部署端而言——样式表同步检查。
