---
description: "在轮次结束前，用该轮次的请求与工具结果复核改动文件轮次的最终回复的守卫，供配置或调试它的用户与维护者阅读。"
kind: "package-reference"
---

# @aeven/turn-review

[English](README.md) | 中文

## 概述

模型可能在请求仍未完成、或自己的工具结果恰恰相反时，用「已完成」「已验证」结束一个轮次。`avn-turn-review` 在结束前读取每个改动了文件或最终回复包含筛选出的行动承诺的轮次：一次辅助模型调用接收该轮次的用户消息、工具调用、工具结果与最终回复，并指出未做的请求、做法与要求不同的请求、没有任何工具结果支持或与工具结果矛盾的断言，以及在最后一次编辑之后没有任何观测却被说成可用的改动。发现的问题会带着清单把智能体送入另一个步骤；干净的复核、失败的复核调用，或用完的每轮配额都允许轮次结束。它在 `avn` 基础 bundle 中默认启用。

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

当组合暴露文件编辑工具时，把本插件挂在模型运行时旁边。基础 bundle 按默认值挂载它，无需任何配置。

### 何时选择它

当智能体编辑文件，且产品的价值取决于轮次最终回复与工具实际所做之事相符时，选择它。被选中的轮次需要一次辅助模型调用；没有行动承诺的普通对话不会被选中。复核刻意收得很窄：只报告未做或被做反的请求、无支持或被矛盾的断言，以及最后一次编辑之后没有观测却被说成可用的改动——绝不报告风格、措辞或没人要求过的改进。

### 最小配置

```yaml
- name: '@aeven/turn-review'
  config:
    triggerTools: [write, edit, str_replace_editor]
    maxReviewsPerTurn: 2
    maxEntryChars: 2000
    maxTranscriptChars: 60000
    maxOutputTokens: 4000
    timeoutMs: 90000
    # provider: aeven-cloud   # optional explicit review route; pairs with model
    # model: Aeven-1.0-Flash
```

| 字段 | 默认值 | 含义 |
|---|---|---|
| `triggerTools` | `[write, edit, str_replace_editor]` | 其中任一工具成功调用，该轮次就会被复核 |
| `maxReviewsPerTurn` | `2` | 每轮复核轮数；最后一轮之后仍然存在的问题不再阻止轮次结束 |
| `maxEntryChars` | `2000` | 从单个工具参数、工具结果或消息中引用的字符数（保留头与尾） |
| `maxTranscriptChars` | `60000` | 整份记录的字数上限；先丢弃最旧的工具条目，消息与回复保留 |
| `maxOutputTokens` | `4000` | 复核输出上限；达到上限即复核失败，并允许轮次结束 |
| `timeoutMs` | `90000` | 一次复核调用的截止时间 |
| `provider`、`model` | 该轮次的路由 | 显式复核路由；两者同时给出或同时省略，否则加载失败 |

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释一个轮次如何被引用与判定；可观察行为见[使用本包](#use-this-package)。

### 设计理念

插件监听 `agent/turn-stopping`，此时轮次仍可再走一个步骤。它只复核这样的轮次：最后一条 assistant 消息带有文本、没有工具调用也没有被中断，并且该轮次中有触发工具以非错误结果完成，或最终回复匹配英文第一人称行动承诺筛选条件。复核是一次 `ctx.llm.stream` 调用，使用该轮次自己的提供方与模型，或使用配置的显式路由；没有记录路由的会话不会被复核。

复核者按顺序读取由轮次事件构成的 JSON 数组：来源类型为 `user` 的用户消息、每次工具调用及其参数、每个工具结果，以及每条 assistant 回复。每个条目都被裁剪到 `maxEntryChars`，保留头与尾并附上截断标记；整个数组超限时按最旧的调用与结果条目逐个丢弃，直到符合 `maxTranscriptChars`；消息与回复绝不会被丢弃。

发现问题的轮次产生的是一条引导消息，而不是重复的步骤。插件按智能体与轮次计算配额，请求一经派发即消耗一轮，因此问题在 `maxReviewsPerTurn` 之后仍然存在的轮次照样结束。超时、失败、达到 `maxOutputTokens` 或回答中没有可解析判定的复核调用会追加带原因的 `turn-review/failure`，轮次保留原来的回复结束。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：`Config` schema、轮次选择、记录引用、复核调用、判定解析、引导消息 |
| — | 不发布不变式伴生包（No invariant companion is published），因为复核观察的正是它刚刚读过的轮次：请求及其结果已作为 `turn-review/request` 以及 `turn-review/verdict` 或 `turn-review/failure` 记录，报告器只会重新推导出同样的记录，而不是比较彼此独立的观测。 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

包级约定不够用时阅读以下页面。

- [智能体循环](../../core/agent-loop/README.zh.md)——本插件监听的轮次边界。
- [LLM 能力](../../llm/llm/README.zh.md)——复核调用所流经的运行时。
- [bash 编辑守卫](../bash-edit-guard/README.zh.md)——让文件编辑留在调用会被记录的工具内的同类守卫。
- [guard 组地图](../README.zh.md)——相邻的循环卫生与策略插件。
- [基础 bundle patch](../../bundle/base/cordis.patch.yml)——按默认值挂载本插件的组合。

-----

<a id="model-experience"></a>
## 模型体验

### 发现问题的消息

#### 模型看到什么

判定为干净的轮次不会新增消息；没有成功触发调用或筛选出的行动承诺的轮次、以工具调用结束的轮次，以及被中断的轮次都不会被复核。发现的问题以一条归因于 `turn-review`、来源为 `plugin` 的 user 消息出现，每个问题一行；`<issue>` 是复核者用一句话说明的请求或断言，以及工具结果显示的内容。

##### 引导消息

```markdown
Before you finish: a review of this turn against its tool results found these gaps.
- <issue>
- <issue>
Close each one now: do what was asked, or check the result with a tool. Anything you cannot do or check, say plainly in your reply instead of calling it done.
```

#### Token 影响

未被复核、或复核未发现问题的轮次为零 token。一次发现问题的轮次会把该引导消息加入对话记录，同一会话此后的请求都会带着它，直到压缩。

#### KV Cache 影响

仅追加。引导消息进入该轮次已经发出的前缀之后，因此可复用的前缀是延长而不是被打断。

### 复核请求

#### 模型看到什么

复核是一次独立的模型请求。它的系统提示词由本包固定，并指明复核者只可报告的四个问题；它唯一的用户消息是 `Review this turn:` 加上作为 JSON 数组引用的记录，条目为 `user`、`call`/`arguments`、`result`/`error` 与 `assistant`。复核者只以 JSON 作答。

##### 复核系统提示词

```markdown
You review the work an AI assistant did in one turn, before its final reply reaches the user.
You receive the turn as a JSON array in order: the user's messages (including messages sent while the assistant was working), the assistant's tool calls with their results, and the assistant's replies. The last reply is the one about to be sent.
Find only these problems:
1. A user request in this turn that was not done, was done differently than asked (for example a value set to the opposite of what was asked, or an approximation where the user asked to copy), or was dropped without the reply saying so.
2. A claim in the final reply (done, fixed, verified, matches, works, green) that no tool result shows, or that a tool result contradicts.
   This includes a claim that something does not exist, is missing, or is not supported when the tool result behind it read only a filtered, truncated, or partial view: a search pattern or filter that could not match the thing, a cut list, or a first page.
3. A change presented as working although no tool result observed it after the last edit; for a visual or UI change, observing means a browser read or screenshot taken after the last edit and build.
4. A reply claims work is starting, running, or continuing without a corresponding dispatched tool or continuing job, or promises to act after the turn ends with no job to do it.
For an action request, listing unfinished authorised work is not completion. Report it unless the user stopped or changed the task, or a concrete blocker requires user input. Questions and requests for a plan do not require execution.
Do not report style, wording, scope suggestions, or improvements nobody asked for. Disclosing that a check was not run avoids a false verification claim but does not excuse leaving requested work unfinished.
Answer with JSON only, no prose and no code fence: {"complete": true, "issues": []} or {"complete": false, "issues": ["..."]}. Each issue is one sentence that names the request or claim and what the tool results show.
```

#### Token 影响

每轮复核一次请求：固定的系统提示词、最多 `maxTranscriptChars` 的引用记录，以及最多 `maxOutputTokens` 的回答。除非发现的问题引导出另一个步骤，否则这些内容都不进入被复核轮次自身的请求。

#### KV Cache 影响

相互独立。复核调用有自己的前缀——固定的系统提示词加上每轮都不同的记录——因此它既不复用被复核轮次的缓存，也不改变它。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

这些限制说明复核能确立什么、不能确立什么。它们是当前包约束，不是任务清单。

- **英文承诺筛选** — 额外筛选只识别部分英文第一人称行动短语，其他措辞和语言可能漏过。角色提示规则独立于此筛选生效；筛选本身不会派发工具，是否存在未完成的请求由复核模型判断。
- **被裁剪的证据**：复核读取的工具结果被裁剪到 `maxEntryChars`，超出 `maxTranscriptChars` 的最旧工具条目会被丢弃，因此这些预算之外的证据对它不可见。
- **未触发的改动不会被复核**：在触发工具之外做出的文件改动，例如通过 `bash` 运行的格式化器，不会自行触发复核。没有筛选出的行动承诺时，只浏览网页、抓取内容或运行命令的轮次同样不会被复核，因此其中关于页面或结果显示了什么的断言不会被检查；把这些工具加入 `triggerTools` 即可复核这类轮次，代价是每轮多一次复核调用及其等待时间。
- **发现只是建议，不是强制**：`maxReviewsPerTurn` 轮之后，轮次会带着未解决的问题结束；失败、超时或无法解析的复核会保留原来的回复。
- **不发布不变式伴生包**：复核观察的正是它刚刚读过的轮次——请求及其结果已作为 `turn-review/request` 以及 `turn-review/verdict` 或 `turn-review/failure` 记录，报告器只会重新推导出同样的记录，而不是比较彼此独立的观测。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

复核只报告：它从不编辑、不重试工具、也不阻止释放。它的系统提示词是模型可见文本，并在派发之前原样记录到 `turn-review/request`，因此改动它会改变重放所重建的内容。判定解析器容忍 JSON 对象之外的散文，其余情况一律让复核失败——而不是让轮次失败。

</details>
