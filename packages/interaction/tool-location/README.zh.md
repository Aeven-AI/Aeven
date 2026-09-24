---
description: "面向模型的 get_location 工具：部署如何挂载它、限定其等待、设置其精度，以及模型看到的内容。"
kind: "package-reference"
---

# @aeven/tool-location

[English](README.md) | 中文

## 概要

`@aeven/tool-location` 让模型询问读者身在何处。它注册一个工具 `get_location`，其调用会成为一个 `location/request` waterfall，由显示该会话的客户端应答。读者批准位置权限或拒绝；没有这一批准就不会读取任何内容，而且模型会在询问读者之前说明为什么需要位置。没有能够询问的客户端时，调用报告位置不可用。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用此包

在客户端能够询问读者的代理组合中挂载本插件，例如带有 `@aeven/client-ui-location` 的 Web 客户端。随附的 `cordis`、`standard` 与 `ptc` 预设都会挂载它。

### 配置

两个字段均为可选；无效值会使插件加载失败。

| 字段 | 默认值 | 作用 |
| --- | --- | --- |
| `precision` | `precise` | `precise` 原样传递设备读数。`approximate` 把纬度和经度四舍五入到两位小数（约 1.1 km），并报告至少 1,100 m 的精度。 |
| `consentTimeoutMs` | `120000` | 读者做出选择的毫秒数，声明为该工具的 `timeoutMs`。由 `@aeven/tool-call-timeout-policy` 执行，模型收到 `TOOL_TIMEOUT`。 |

```yaml
- id: tool-location
  name: '@aeven/tool-location'
  config:
    precision: approximate
```

绝不能询问位置的部署省略这一行。

<a id="understand-the-implementation"></a>
## 理解实现

工具以调用方代理为作用域派发 `location/request`，携带模型的 `purpose` 与调用的 signal。在 Web 组合中，`@aeven/api-remotes` 把它转发给 Typert 网关，网关把它投递给每个已连接的客户端并等待其中一个应答；工具超时限定这次等待。无法询问的监听器调用 `next()`，最终的回退应答 `unavailable`。原生提供者（例如在 Host 上读取 Core Location 的提供者）可以应答同一个 waterfall。

应答是 `device`（纬度、经度、`accuracyMeters`、时间戳）、`declined`、`unavailable`（原因）或 `manual`（具名地点，供提供该选项的应答者使用；Web 客户端不提供）之一。`renderLocationAnswer` 按配置的精度把它转换为工具结果。

## Model Experience

### 工具 schema

#### What the model sees

模型看到生成的 [`get_location` schema](../../../docs/tool-catalog.zh.md#aeventool-location)。设备应答是一个 JSON 对象，含 `source: "device"`、`precision`、`latitude`、`longitude`、`accuracyMeters` 与 ISO `timestamp`；输入的地点是 `{"source": "manual", "place": …}`。

##### 拒绝结果

```markdown
The user declined to share their location. Ask where they are if the task needs it, or continue without it.
```

##### 不可用结果

```markdown
The location is unavailable: <reason>. Ask the user where they are if the task needs it.
```

#### Token effect

工具可见时 schema 每个请求固定；一次调用追加一条简短结果。

#### KV Cache effect

在可见工具集不变时前缀稳定；结果被追加。

## Known Limitations and Deferred Work

- **没有原生操作系统提供者** —— Web 客户端读取浏览器的 Geolocation API。Electron 的 Chromium 定位可能需要 Google API key，因此桌面应用可能报告位置不可用；在 Host 上应答 `location/request` 的 Core Location、Windows.Devices.Geolocation 或 GeoClue 提供者被推迟。
- **没有保存的地点** —— 读者批准浏览器的位置权限；浏览器允许该网站之后，后续请求会不显示卡片、直接读取设备。
- **坐标会到达模型** —— 目前没有能直接消费坐标的地点或地理编码工具，因此模型收到它用于搜索的坐标。

<a id="dev-note"></a>
### Dev Note

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
