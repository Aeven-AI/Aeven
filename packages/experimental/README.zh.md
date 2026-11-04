---
description: "实验组地图：不进入正式发布的私有原型与内部专用插件，供浏览本组的用户与维护者阅读。"
kind: "package-group"
---

# packages/experimental

[English](README.md) | 中文

## 概述

实验组包含不属于任何正式发布的原型能力：它们运行在真实 harness 上，但约定可能变更，也不提供支持承诺。本组包含跨 realm Inspector、代码执行 seam 的 CPython 子进程后端、已安装 Cua Driver 的计算机操作提供方、绘制智能体指针的浏览器覆盖层，以及预览部署使用的浏览器 worker 运行时与镜像打包器。用这些包来尝试未发布的能力；它们没有稳定性承诺，已发布产品不得依赖它们。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)
- [开发备注](#dev-note)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`browser-overlay`](browser-overlay/README.zh.md) | 在被操作的浏览器中绘制智能体指针与动作反馈 | — |
| [`code-runtime-python`](code-runtime-python/README.zh.md) | 代码执行 seam 的 CPython 子进程后端 | `ctx.codeRuntime` |
| [`computer-use-cua-driver-mcp`](../computer-use/computer-use-cua-driver-mcp/README.zh.md) | 通过已安装的 Cua Driver MCP 可执行程序进行实验性本地桌面控制 | `ctx.computerUse` |
| [`inspector`](inspector/README.zh.md) | 用于 Host 调试、Client Runtime 检查、网络采集与 Cordis 树的跨 realm CDP hub | `ctx.inspector` |
| [`subscription-auth`](../llm/subscription-auth/README.zh.md) | 编码订阅 OAuth 路由、额度上报与媒体生成 | 注册 LLM 路由与 scoped 工具 |
| [`webworker-packer`](webworker-packer/README.zh.md) | 构建浏览器 worker 预览所消费的 gzip 压缩 VFS 镜像 | 库与 CLI，不使用 ctx key |
| [`webworker-runtime`](webworker-runtime/README.zh.md) | 在专用浏览器 worker 中运行 harness 插件树 | 库与 worker 入口，不使用 ctx key |

-----

<a id="related-documentation"></a>
## 相关文档

- [实验包决策](../../.agents/notes/implemented/architecture/2026-08-18-experimental-agent-teams-packages.zh.md)——位置、发布排除与依赖隔离。
- [代码运行时子系统](../../docs/subsystems/code-runtime.zh.md)——CPython 后端所实现的代码执行 seam。
- [实验子树规则](AGENTS.md)——实验状态放宽了什么、不放宽什么。

-----

<a id="dev-note"></a>

<a id="开发备注"></a>

## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
