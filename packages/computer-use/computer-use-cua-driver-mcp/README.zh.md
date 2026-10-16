---
description: "通过已安装的 Cua Driver MCP 可执行程序和独占提供者注册，配置本地计算机使用能力。"
kind: "package-reference"
---

# @aeven/computer-use-cua-driver-mcp

[English](README.md) | 中文

## 概述

让模型通过已安装的 Cua Driver 操作本地桌面。将本包与 computer-use 服务一同挂载，即可通过 MCP 提供驱动自身的工具描述、参数和结果。安装和桌面权限由 Cua Driver 负责，默认不启用任何驱动。提供者在连接和工具完成关闭前持续占用计算机使用能力；并发 Session 由调用方自行协调。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延后工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 Cua Driver 已在运行 Aeven 的同一台机器上安装并配置好时，选择此提供者。平台设置以[上游安装和权限指南](https://github.com/trycua/cua/blob/cua-driver-rs-v0.35.4/libs/cua-driver/README.md)为准。

### 最小配置

将以下条目加入已提供 tools 和 system-prompt 服务的组合。截图还需要附件存储，以及声明支持图像输入的模型路由。

```yaml
- name: '@aeven/computer-use'
- name: '@aeven/computer-use-cua-driver-mcp'
  config:
    command: cua-driver
    args: [mcp]
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `command` | `cua-driver` | 已安装的可执行程序路径或 PATH 命令 |
| `args` | `[mcp]` | 不经过 shell、直接传入的参数 |
| `embedded` | `false` | 以宿主应用的嵌入式子进程运行驱动，并追加 `--embedded --direct` |
| `toolCallTimeoutMs` | MCP 客户端默认值 | 单次调用的超时覆盖值，单位为毫秒 |
| `reconnect` | MCP 客户端策略 | 可选的重连覆盖配置 |

组合在挂载本包时会传入明确的 `command`，即各平台的安装位置：macOS 上为 CuaDriver 应用包，Windows 上为 `%LOCALAPPDATA%\Programs\Cua\cua-driver\bin\cua-driver.exe`，Linux 上为 `~/.local/bin/cua-driver`（用户级安装写入的脚本位置）。`AVN_CUA_DRIVER` 可覆盖它；已安装的桌面应用会把它设为自带的驱动，并通过 `AVN_CUA_DRIVER_EMBEDDED=1` 选择 `embedded`。这些默认值都是绝对路径，因此驱动不存在时会走下面的安装指引路径，而不会导致组合失败。

生成的[配置目录](../../../docs/config-catalog.zh.md#aevencomputer-use-cua-driver-mcp)列出了接受的字段。超时和重连默认值由 [MCP 客户端](../../mcp/mcp-client/README.zh.md)定义。

### 激活与所有权

提供者在连接前以 `cua-driver-mcp` 注册。第二个计算机使用提供者会激活失败，包括本包的另一个实例。初始化或首次工具发现失败会使本条目激活失败，并在清理后释放注册。之后连接断开时，MCP 客户端重连或耗尽尝试次数均保留注册；卸载条目才会释放注册。

模型看到的工具使用固定的 `mcp__cua-driver-mcp__` 命名空间。工具名称、描述、输入模式、规范结果和图像准入遵循现有 [MCP 桥接器](../../mcp/mcp-client/README.zh.md)。本包不额外提供 Aeven 操作目录或提供者选择工具。提供方只添加一个自有工具 `computer_use_setup`：每次调用都先请求用户批准，然后启动驱动的 `permissions grant` 流程。在 macOS 上，该流程通过 LaunchServices 启动 CuaDriver，使系统将辅助功能与屏幕录制请求归属于该应用，并打开对应的系统设置面板。工具不等待该流程结束；模型随后以 `prompt: false` 调用 `check_permissions` 重新检查。`embedded` 驱动则运行在宿主应用的启动链内，macOS 检查的是该应用的授权，驱动本身从不弹出请求；此时在 macOS 上 `computer_use_setup` 会通过 `osascript` 为宿主应用请求辅助功能与屏幕录制权限，并告诉用户开启后重新打开该应用。在 macOS 上，嵌入式驱动没有代理光标叠加层。

当 `command` 是不存在的绝对路径时，提供方既不预留计算机使用，也不启动驱动，只注册 `computer_use_setup`：其描述告诉模型计算机使用需要 Cua Driver，其结果给出缺失的路径和上游安装指南。因此在未安装驱动的机器上，该能力仍可通过工具搜索发现；用户安装后重启 Aeven 即可。PATH 命令在启动前不做检查。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节 — 点击展开</summary>

[`src/index.ts`](src/index.ts) 将计算机使用注册和所属 MCP 子插件归入同一个有序副作用。子插件完成清理后才运行注册释放函数，激活失败时也遵循这一顺序。MCP 客户端负责凭据过滤、子进程终止、工具同步、取消和持久化图像投影。

本包不发布运行时不变量伴随插件：提供者没有独立的驱动状态可与注册比较，连接和工具代次由子插件持有。

### 验证已安装的驱动

在仓库根目录，用 Cua Driver 可执行程序的绝对路径显式启用真实兼容性测试。测试发现工具，以 `prompt: false` 调用 `check_permissions`，并验证清理结果。在 macOS 上，`--direct` 使用启动宿主的权限在 MCP 进程中运行驱动；省略 `AVN_COMPUTER_USE_MCP_ARGS` 则使用默认的 `["mcp"]` 参数。

```sh
AVN_COMPUTER_USE_MCP_EXECUTABLE=/absolute/path/to/cua-driver \
AVN_COMPUTER_USE_MCP_ARGS='["mcp","--direct"]' \
pnpm run test:e2e packages/computer-use/computer-use-cua-driver-mcp/tests/installed-driver.e2e.ts
```

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [计算机使用服务](../../computer-use/computer-use/README.zh.md) — 独占具名注册。
- [MCP 客户端](../../mcp/mcp-client/README.zh.md) — 协议发现、执行和图像行为。
- [Cua Driver](https://github.com/trycua/cua/blob/cua-driver-rs-v0.35.4/libs/cua-driver/README.md) — 上游可执行程序和平台设置。

-----

<a id="model-experience"></a>
## 模型体验

### Cua Driver 工具与截图

#### 模型可见内容

已安装驱动声明的工具描述和输入模式使用 `mcp__cua-driver-mcp__<tool>` 名称呈现。成功调用保留有序文本和已准入截图；不支持图像的路由会收到 MCP 桥接器的诊断文本。工具调用和投影后的结果通过正常执行流程进入 Session 日志。

#### Token 影响

已注册模式进入模型请求，工具参数、文本结果和已准入图像持续占用上下文，直到压缩。规范结果中的内联图像字节不会写入 Session 事件；持久化附件引用标识模型可见图像。

#### KV 缓存影响

工具发现结果不变时，工具定义前缀保持稳定。目录变化可能从第一个变化的模式开始使缓存失效；追加的工具结果保留此前的请求前缀。

## 已知限制与延后工作

<a id="known-limitations-and-deferred-work"></a>

此提供者依赖已安装的驱动及 MCP 桥接器支持的能力。

- 桌面访问需要完成上游安装并取得平台权限；插件激活本身不能证明每个桌面操作都已获准。
- 多个 Session 共享一个桌面。一次运行一个计算机使用工作流，或在外部协调；注册不会串行化 Session 的操作。
- 驱动升级可能改变发现的目录。本提供者不支持运行时驱动切换、专用桌面权限界面或 Aeven 操作抽象。
- 启动时限及富结果限制遵循 [MCP 客户端的限制](../../mcp/mcp-client/README.zh.md#known-limitations-and-deferred-work)。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>
