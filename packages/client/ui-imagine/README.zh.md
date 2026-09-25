---
description: "Imagine 界面：在 /i/<id> 以其页面取代对话占据中间栏。"
kind: "package-reference"
---
# @aeven/client-ui-imagine

[English](README.md) | 中文

## 概要

Imagine 是位于 `/i/<id>` 的独立页面，与对话 Session 相互分离。插件在布局的界面路由（`ctx.layout.surfaces`）上声明 `/i` 路径根，并把页面贡献到 `surface` slot，因此地址位于 `/i` 之下时，中间栏显示 Imagine 而非对话，对话的详情栏与右侧边栏保持关闭。裸 `/i`，或 id 不是 UUID 的地址，会被原地改写为新的 `/i/<uuid>`。该 id 不指向任何 Session。

起始页就是对话的新会话界面：产品名与读者的问候语（对话的 `HeroShell`），其下是一张沿用对话首屏输入框几何尺寸的输入卡片。卡片会保留读者输入的内容；在 Imagine 能够生成之前，添加与发送控件保持禁用。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

无，因为 Imagine 页面上的任何内容都不会进入模型请求。

#### KV Cache effect

无；该页面不发送请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **尚无生成能力** —— 输入卡片可以输入文字，但不会发送任何内容；添加与发送控件处于禁用状态。
- **输入卡片重述了对话卡片的 CSS** —— 其取值沿用 ui-conversation 的首屏输入框，在两个输入框共用同一组件之前，那边的改动需要同步到这里。
- **没有导航入口** —— 侧边栏的 Imagine 行尚未链接到这里；只能通过地址访问该页面。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
