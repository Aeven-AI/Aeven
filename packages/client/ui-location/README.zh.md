---
description: "浏览器位置许可界面，通过作用域交互路径以读者的选择应答 get_location。"
kind: "package-reference"
---
# @aeven/client-ui-location

[English](README.md) | 中文

## 概述

基于 Agent 作用域 `location/request` Remote Event waterfall 的浏览器位置许可，其中浏览器自己的许可提示就是读者唯一的一次批准。模型调用 `get_location` 且浏览器已允许该网站时，插件直接读取位置，不显示任何内容。否则它立即开始读取，从而打开浏览器提示，并用**允许 Aeven 获取你的精确位置？**、模型的用途和两个按钮接管 Conversation 输入区：**好**会再次读取，供关闭了提示或尚未回应提示的读者使用；**不**只拒绝本次请求。

## 目录

- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="model-experience"></a>
## Model Experience

无，因为本包在浏览器中呈现位置请求；模型看到的内容由 `@aeven/tool-location` 负责。

#### KV Cache effect

无；呈现请求并返回读者的选择不会改变模型请求。

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **仅限安全页面** —— 浏览器只在 https 或回环地址下提供定位，因此通过 http 在局域网地址上打开的页面会报告位置不可用。
- **被阻止的网站保持阻止** —— 读者阻止提示后，卡片会请他们在浏览器设置中允许该网站；页面无法重新打开浏览器已阻止的提示。
- **Electron 需要原生提供者** —— Electron 中的 Chromium 定位可能需要 Google API key；在 Host 提供者应答 `location/request` 之前，桌面卡片可能报告位置不可用。
- **不变量省略** —— 不发布运行时不变量伴随模块，因为每个请求都在显示该会话的那一个窗口内被一次性应答：位置、卡片与读者的选择只作为该窗口的待处理交互存在，而 `location/request` waterfall 的顺序由 Host 端拥有者维持。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
