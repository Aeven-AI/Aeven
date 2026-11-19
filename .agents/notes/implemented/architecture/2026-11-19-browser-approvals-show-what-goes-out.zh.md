# Agent Note：浏览器审批写明要发出的内容并显示文本，页面脚本绝不发布

Status: implemented

[English](2026-11-19-browser-approvals-show-what-goes-out.md) | 中文

## 问题

通过用户浏览器编辑一条 LinkedIn 回复时弹出了两次「Run a script that clicks or submits in the page on a website」：一次是打开评论「…」菜单的脚本，一次是点击「Edit」的脚本。两者都没有发布任何内容。真正发布修改的「Save changes」点击却没有询问。两次提示都没有说明要发布什么。原因如下：

- 只要脚本执行点击且源码中任意位置提到发布动词，`isSendScript` 就会询问；LinkedIn 的元素 id `replaceableComment_urn:li:comment:…` 和菜单文本「Copy link to comment」都含有「comment」。
- 「Save changes」不以发布动词开头，所以点击直接通过。
- 提示只带通用理由，而 preview 工具没有可供卡片显示的消息参数。扩展返回的状态不含页面地址，所以理由写的是「on a website」，也没有提供按站点的授权。

## 决定

- `isSendLabel` 只匹配以发布动词开头的标签（「Send」「Post comment」「Reply」），不匹配只是提到这类词的标签。动词按组划分（`PublishVerb`），其中 `commit` 组（Save、Update）只有在保存已撰写文本时才算发布。
- `@aeven/browser-chromium/src/outbound-probe.ts` 在对 CSS 选择器执行 `preview_click` 以及 `preview_press` Enter 之前于页面中运行。它报告被点击控件的动词、最近输入框中的文本（向上查找到包含该控件的 article、dialog 或 form 为止）、邮件收件人和主题，以及文档地址。Reply、Comment 和 Save 只在该输入框有文本时询问；Send、Post、Repost、Invite 和 Submit 总是询问。
- `ApprovalRequestEvent` 和 `approval/asked` 携带 `outbound`（kind、site、to、subject、text）。现有审批卡片以该类型开头（「在 linkedin.com 发布这条回复」，提供 zh、en、es），并在带标签的 收件人 / 主题 / 消息 行中显示内容。
- 页面脚本不再按源码文本询问。在网站上，每个 `preview_evaluate` 都在一个防护下运行：探测判定为发布的程序化点击、合成点击或 Enter、表单提交会被拒绝，控件被标上 `data-aeven-send`，调用失败并提示改用 `preview_click` 点击它，而 `preview_click` 会带着内容询问。发送写入请求的脚本仍然询问。受信任的指针或按键事件会解除防护，因此用户自己的点击和工具通过调试器发出的点击都不会受影响。

## 考虑过的替代方案

- **把 Save 加入发布动词。** 已否决：每个设置页面都会询问。Save 只在保存已撰写文本时询问。
- **让模型声明它要发布的内容。** 已否决：提示必须显示页面将要发送的内容，而不是模型声称发送的内容。
- **分两遍运行页面脚本，先找出其中的点击。** 已否决：试运行会重复脚本的其他所有副作用。

## 影响

探测只解析纯 CSS 选择器；点击无障碍 token 或 `text=`/`role=` 定位器时只按标签判定，不带内容。防护约束的是 agent 的脚本，而非页面：保留了原生方法引用的页面，或直接调用框架处理函数的脚本，都不会被它拦住。Chrome DevTools 工具保留标签和脚本文本规则，并采用更严格的以动词开头的标签匹配。
