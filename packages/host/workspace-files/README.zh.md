---
description: "经过认证的只读 HTTP 路由，提供已注册工作区中的文件，使 Agent 生成的文件可以在渲染后的模型回复中被引用。"
kind: "package-reference"
---

# @aeven/host-workspace-files

[English](README.md) | 中文

## 概述

在 Web GUI 中渲染的模型回复可以显示图片，但仅限 `http` 或 `https` URL —— 文件系统路径会被渲染器拒绝。`avn-host-workspace-files` 正是为生成的文件提供这样一个 URL：它在 [webserver](../webserver/README.zh.md) 上注册一条前缀路由，从[工作区注册表](../../workspace/workspace/README.zh.md)中某个工作区的规范目录提供 `<mount>/<workspaceId>/<相对路径>`。在解析任何路径之前，每个请求都要通过 Connection 的 Host/Origin 围栏与浏览器认证；越出工作区目录的穿越返回 403，未知工作区 id 或文件缺失返回 404，非 GET/HEAD 返回 405。提供过程是只读的：该路由从不写入、列举或删除。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与待办](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当宿主面向浏览器、且其 Agent 会生成用户应当在对话中看到的文件（渲染出的图表、截图、生成的示意图）时，编排本插件。它需要 `webServer`、`connection` 与 `workspaceRegistry`。

### 最小配置

```yaml
- name: '@aeven/host-workspace-files'
  config:
    mount: /workspace
```

`mount` 是绝对路由前缀，不带尾部斜杠。它是配置而非常量，因为已将 `/workspace` 用作他途的部署必须能够移动这条路由，而不必修改源码。

### 该路由提供什么

对 `<mount>/<workspaceId>/<相对路径>` 的 GET 或 HEAD 会读取该工作区规范目录下的对应路径并返回其字节。`workspaceId` 是注册表 id 而非目录名，因此 URL 从不拼写宿主路径。已知的图片、PDF 与文本扩展名会获得相应的内容类型；其余一律以 `application/octet-stream` 发送，浏览器会下载而不是执行。每个响应都带有 `X-Content-Type-Options: nosniff`、`default-src 'none'; sandbox` 的内容安全策略以及 `Cache-Control: no-store`，因此被重写的文件会在其 URL 不变的情况下重新提供，而作为顶层文档打开的 SVG 无法运行脚本或发起请求。

### 该路由带来的暴露面

整个工作区目录对任何持有有效浏览器会话的客户端都是可读的 —— 包括源码、点文件与凭据。该路由绝非公开：`ctx.connection.requestRejection` 在任何路径处理之前运行，因此未认证的调用方甚至无法区分真实的工作区 id 与编造的 id。若某个部署不得将工作区内容通过 HTTP 暴露，应移除该行而不是重新配置它，并同时移除界面提示词中关于工作区 URL 的那句话。

### 可观察的失败

未知工作区 id、文件缺失以及目标为目录，三者都返回空的 404 —— 该路由从不透露具体是哪一种。解析后越出工作区目录的路径返回 403。非 GET/HEAD 返回 405。未认证请求收到 Connection 自身的 401 或 403。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现内幕 —— 点击展开</summary>

### 设计概念

本包是围绕 `serveWorkspaceFile` 的一个函数插件。`apply` 在 effect 作用域下注册一条前缀路由，因此销毁 fiber 会释放它，重载则可干净地重新注册。处理器先认证，拒绝非 GET/HEAD，剥离 mount 前缀，再把剩余部分连同一个「由工作区 id 解析出目录」的闭包交给 `serveWorkspaceFile`。注册表查找保持为闭包而非所提供路径的参数，因此提供逻辑本身从不持有服务引用。

### 穿越围栏

依次会发生两次规范化，而只有第二次属于本包。`new URL(...)` 在路由看到路径之前就折叠了点号片段，因此朴素的 `../` 根本无法存活到被解析。经过编码的斜杠则能越过这一步，且只有在处理器解码 pathname 之后才成为 `..` 片段 —— 这正是 `serveWorkspaceFile` 要重新解析拼接后的目标、并要求它等于工作区根目录或位于其下的原因。该检查使用 `sep` 而非 `/`，因为 `resolve()` 在 Windows 上输出反斜杠路径，此时以 `/` 作后缀会把每一条合法子路径都判为穿越。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | `serveWorkspaceFile` 与 `apply`：路由注册、认证顺序、穿越拒绝、MIME 与安全响应头 |

</details>

-----

<a id="further-exploration"></a>
## 延伸阅读

当提供契约本身不足以说明问题时阅读这些：路由席位、id 来源，以及挂载该行的编排。

- [Webserver](../webserver/README.zh.md) —— 本插件注册进入的具名路由表。
- [工作区注册表](../../workspace/workspace/README.zh.md) —— `workspaceId` 及其规范目录的来源。
- [avn-web-app bundle](../../bundle/web-app/README.zh.md) —— 挂载该行并在界面提示词中陈述 URL 形式的编排。
- [生成的配置目录](../../../docs/config-catalog.zh.md#aevenhost-workspace-files) —— 所有可接受的配置字段及其源声明。

-----

<a id="model-experience"></a>
## 模型体验

Indirectly, through the [avn-web-app](../../bundle/web-app/README.zh.md) surface prompt: it states the URL form, so a model that produced a file can reference it as `![alt](<webUrl>/workspace/<workspaceId>/<path>)` and have the reply render the image instead of reporting a filesystem path the renderer refuses.

#### KV Cache 影响

无；本包既不组装也不发送 Provider 请求。

## 已知限制与待办

<a id="known-limitations-and-deferred-work"></a>

这些限制界定了所提供界面尚不够用的场合。它们是当前的包约束，而非任务待办清单。

- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包唯一拥有的关系是它那条具名路由，而 webserver 已在 `register()` 处拒绝重复的 `(kind, path)` 注册。拆卸流探针还会在正确释放时误报，因为 `internal/plugin` 先于正在释放的 fiber 的 effect 触发，通知时合法拥有者仍持有该路由。注册／释放的对称性改由本包的 HMR 安全性测试覆盖。
- **整目录暴露是唯一粒度** —— 该路由把工作区目录下的一切提供给已认证的读取方。需要更窄的发布子树或按文件规则的部署没有相应配置，只能省略该行。
- **不支持 Range 请求或流式传输** —— 每个响应都会先把整个文件读入内存再写出，因此大型媒体文件被整体提供，浏览器无法在其中定位。
- **MIME 表覆盖的是生成产物** —— 图片、PDF 与常见文本类型。其余扩展名在相应资产类别落地之前，均以 `application/octet-stream` 下载。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作背景 —— 点击展开</summary>

无。

</details>
