---
description: "拒绝就地修改现有源文件的 shell 命令的守卫，供配置或调试它的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/bash-edit-guard

[English](README.md) | 中文

## 概述

通过 shell 脚本编辑源代码会跳过 `edit` 与 `write` 工具所保证的东西：`edit` 在待替换文本不存在时失败，并要求文件已被读取，两者都会为已编辑文件卡片和会话日志记录该改动。Python 的 `str.replace` 在没有匹配时也报告成功。`avn-bash-edit-guard` 会拒绝这样的 `bash` 命令：它指名一个携带源码扩展名的现有文件，并就地编辑该文件（`sed -i`、`perl -i`）、通过脚本调用写入（`open(…, 'w')`、`write_text`、`writeFileSync` 等），或重定向进该文件（`>`、`>>`、`tee`）。创建新文件、写入临时输出、构建、安装以及其他所有程序运行都会通过。它在 `avn` 基础 bundle 中默认启用。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当智能体通过 `bash` 工具编辑源代码时，把本插件挂在工具注册表旁边。基础 bundle 按默认值挂载它，无需任何配置。

### 何时选择它

当组合向同时拥有 `edit` 与 `write` 的智能体暴露 shell 工具时，选择它。shell 工具触及不到用户自己文件的组合——带有自己编辑工具的远程沙箱执行器，或只读 shell——从中得不到任何收益。本守卫只拒绝，从不改写命令，因此希望脚本化编辑成功的产品不应把本插件纳入组合。

### 最小配置

```yaml
- name: '@aeven/bash-edit-guard'
  config:
    tools: [bash]
    # sourceExtensions: [ts, tsx, css, …]   # defaults cover common source, markup, config, and docs files
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `tools` | `[bash]` | 会检查其命令的 shell 工具名 |
| `sourceExtensions` | 常见源码、样式、标记、配置与文档扩展名 | 视为源文件的扩展名（不带点） |

路径按调用的 `workdir`、会话 cwd 以及命令中每个 `cd` 目标解析。系统临时目录下的文件绝不会被拒绝。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释一条命令如何被判定；可观察行为见[使用本包](#use-this-package)。

### 设计理念

插件在其 fiber 的整个生命周期内注册一个 `ctx.tools.guard` 回调。注册表在匹配的工具运行之前调用它，返回的字符串会成为该调用的错误结果而不是执行。该回调是作用于命令文本及其指名文件的谓词：就地编辑或脚本写入的模式会标记该命令，命令中每个路径 token 都会按调用的基准目录解析，当其中之一存在且带有源文件扩展名时命令被拒绝。重定向与 `tee` 目标按同样方式解析。临时目录路径会被跳过，因为那里的临时输出不是源代码编辑。

两次调用之间消失或无法 stat 的路径按不存在处理，因此竞态绝不会因一个已消失的文件而拒绝命令。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、命令模式、路径解析、拒绝文本 |
| — | 不发布不变式伴生包（No invariant companion is published），因为守卫不持有持久状态，也不持有第二个观测：它只根据命令文本及其指名文件返回一个字符串或什么都不返回，因此报告器只会重新运行同一个谓词，而不是比较两个独立的读取方。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定不够用时阅读以下页面。

- [工具注册表](../../core/tools/README.zh.md)——本插件注册的守卫钩子。
- [bash 工具](../../shell/tool-bash/README.zh.md)——大多数组合所守卫的 `bash` 工具。
- [轮次复核](../turn-review/README.zh.md)——读取改动文件轮次最终回复的同类守卫。
- [guard 组地图](../README.zh.md)——相邻的循环卫生与策略插件。
- [基础 bundle patch](../../bundle/base/cordis.patch.yml)——按默认值挂载本插件的组合。

-----

<a id="model-experience"></a>
## 模型体验

### 被拒绝的就地编辑

#### 模型看到什么

被拒绝的调用返回一条工具错误，按调用的 `workdir` 给出目标文件，并告诉模型应改用哪个工具。`<tool>` 是被拒绝命令所属 shell 工具的名称；`<path>` 是该命令原本会改动的文件。

##### 拒绝文本

```markdown
<tool> refused: this command would change the existing file <path> in place. Change existing files with the edit tool (or write to replace a whole file): it fails when the text to replace is absent and records the change. Keep <tool> for builds, git, installs, and running programs; creating new files and writing scratch output are not refused.
```

#### Token 影响

未触发拒绝的轮次为零 token：本插件不注册提示词段落、工具定义或 schema。被拒绝的调用会把这一条结果加入对话记录，每次被拒绝的调用一条，保留到压缩。

#### KV Cache 影响

仅追加。拒绝作为工具结果出现在它所回应的请求前缀之后，而本插件对该前缀毫无贡献，因此拒绝绝不会使已可复用的前缀失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明守卫看不到什么。它们是当前包约束，不是任务清单。

- **识别基于命令文本**：自行计算写入路径的脚本，或不被识别的写法，都会通过。
- **写入命令中的读取也会被拒绝**：只读取一个现有源文件但同时向别处写入的脚本命令会被拒绝；模型改用 `read` 读取该文件。
- **只统计已配置的扩展名**：扩展名不在 `sourceExtensions` 中的源文件仍可通过 shell 编辑。
- **不发布不变式伴生包**：守卫不持有持久状态，也不持有第二个观测——它只根据命令文本及其指名文件返回一个字符串或什么都不返回，因此报告器只会重新运行同一个谓词，而不是比较两个独立的读取方。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

命令模式是对原始命令字符串的正则表达式：就地编辑器、脚本写入调用、重定向与 `tee`。新识别的写入形式应加入这些表达式，而拒绝语句是模型可见文本，随组合所暴露的工具而变。

</details>
