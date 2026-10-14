---
description: "面向模型的 `elevated` 工具：一次调用如何在 Windows 上经由两次同意以管理员身份运行命令，以及模型会读到什么。"
kind: "package-reference"
---

# @aeven/tool-elevation

[English](README.md) | 中文

## 摘要

`avn-tool-elevation` 在 Windows 上注册 `elevated` 工具。一次调用以管理员身份运行一条命令，而由人做两次决定：先是本工具在启动任何进程之前通过 `ctx.approval` 发出的审批请求，随后是 Windows 的用户账户控制提示。任一提示被拒绝都会让调用失败；命令绝不会改为以模型自身的权限运行。在其他主机上不注册该工具。

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

在任何应让模型能够取得管理员权限的地方组合本包。它需要 `ctx.tools`、`ctx.approval` 与 `ctx.subprocess`。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `timeoutMs` | `600000` | 一次提权运行的默认且最大期限 |
| `maxOutputChars` | `100000` | 保留的捕获输出尾部；更早的输出会被丢弃并加上标记 |

<a id="understand-the-implementation"></a>
## 理解实现

### 两次同意

工具先询问 `ctx.approval`。该请求提供作用域为 `privilege:standard->administrator`、覆盖范围为 `'privilege'` 的会话授权，使人可以让同样的提权在本会话内重复；沙箱授权永远不覆盖它。除 `allowed-once` 之外的任何结果都会在启动任何进程之前以 `ELEVATION_DENIED` 让调用失败。

### 一次运行

`runElevated` 把命令写入一个新临时目录中的作业文件（`job.ps1` 或 `job.cmd`，UTF-8 且不带字节顺序标记），然后通过 `ctx.subprocess` 启动一个普通的 PowerShell。该 PowerShell 调用 `Start-Process -Verb RunAs -Wait -PassThru`，并以提权进程的退出码退出，因此退出码像任何子进程一样传回。提权进程拥有自己的控制台，所以它把合并后的输出写入同一目录中的文件，读取后随目录一起删除。Windows 提示被关闭时 `Start-Process` 会抛出异常；启动器在 stderr 上报告，调用以 `ELEVATION_DENIED` 失败。期限与工具调用的中止信号都会终止启动器；超时以 `ELEVATION_TIMEOUT` 失败。

<a id="further-exploration"></a>
## 延伸阅读

- [@aeven/tool-pwsh](../../shell/tool-pwsh/README.zh.md) —— 兄弟工具，其沙箱升权以同样方式提供会话授权。
- [Agent 备注](../../../.agents/notes/implemented/feature/2026-10-13-on-request-windows-elevation.zh.md) —— 为什么提权是一个工具而不是沙箱模式。

<a id="model-experience"></a>
## 模型体验

### `elevated` 工具 schema

#### 模型看到什么

生成的[工具目录](../../../docs/tool-catalog.zh.md#aeventool-elevation)中的工具条目：名称、描述与四个参数。结果是包含 `exitCode` 与 `output` 的 JSON。

##### 逐字参数描述

```markdown
shell: "powershell" for a PowerShell command, "cmd" for a Command Prompt command.
command: The exact command text to run; multiple lines run as one script.
justification: One sentence, shown to the user, explaining why this command needs administrator rights.
timeoutMs: Deadline in milliseconds, at most 600000 (the default).
```

#### Token 影响

固定：在组合了本包的 Windows 主机上有一个工具条目，与任何调用无关。

#### KV Cache 影响

仅追加：该条目是请求工具列表的一部分，跨轮次保持稳定。添加或移除本包、或修改其配置的期限，会重建该列表。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与待办

- **超时只停止等待，不停止命令** —— 提权进程不是本进程的子进程，因此已在提权侧运行的命令在期限之后仍会继续。
- **作业文件对用户可写** —— 它位于用户临时目录中，因此以同一用户身份运行的受损进程可能在同意与执行之间替换它。
- **每次调用一条命令** —— 重复的管理员工作每次调用都需要一对同意，除非读者授予审批请求所提供的会话作用域。
- **没有自动化测试覆盖** —— Windows 提示需要人来操作；生成的脚本经过了手动验证。
- **无 invariant 伴随模块**——不发布运行时 invariant 伴随模块，因为本包拥有的关系（在 `ctx.approval` 允许之前不启动任何进程）由 Windows 用户账户控制提示决定，只有在有人应答的 Windows 主机上才能观测。

<a id="dev-note"></a>

<a id="开发备注"></a>

### 开发备注

<details>
<summary>面向维护者的工作上下文 —— 点击展开</summary>

无。

</details>
