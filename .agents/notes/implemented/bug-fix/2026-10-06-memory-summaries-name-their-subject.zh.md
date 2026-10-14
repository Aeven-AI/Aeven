# Agent Note: 记忆摘要写明所指对象

Status: implemented

[English](2026-10-06-memory-summaries-name-their-subject.md) | 中文

## Problem

自动召回注入每条 trace 的存储摘要，而 MemOS 摘要器按单次交流生成该摘要，其指令要求省略说话人，并保留“已确认的回答”。用户确认一份关于自己的列表（“you got all right, including ollie”）后，被存储为“User confirmed all correct, including Ollie; keep using that name.”。在“About the user”标题下、紧挨着一行关于用户儿子的记忆，模型把这个昵称归给了儿子。错误回答随后被捕获为 `person` 事实（“Son: …, nickname Ollie”），一次误读就此变成存储的记忆，之后的召回会把它当作佐证呈现。纠正（“no, I go by Ollie not my son”）不匹配任何 `correctionOf` 短语，因此错误的 trace 从未被取代。

## Decision

摘要在 MemOS 写入它的地方修正，因为它同时是 MemOS 为 `vec_summary` 检索嵌入的文本，而 `updateTrace` 不会重新嵌入。`MemOS 补丁`修改摘要器提示：每条事实写明所指对象；关于用户或其认识的人的事实只来自用户本人的话；助手回答的关于他们的问题，以问题本身作为摘要。

每个捕获的轮次只用一次模型调用来写摘要、归档领域并检测纠正。补丁把 MemOS 操作名转发给 Host bridge。`@aeven/memory-memos` 中的 `TurnJudgeContext` 用 AsyncLocalStorage 为每次轮次捕获建立作用域；当 bridge 收到该捕获中含 `ASSISTANT` 段的 `capture.summarize` 请求时，追加领域规则，并在前面加上会话的项目和上一条已捕获的回复。JSON 回答中的 `summary` 交给 MemOS，`domain` 与 `corrects` 交给 Aeven。只有在没有产生判定时才运行单独的分类调用：MemOS 使用非 host 提供方、摘要器回退，或回答未给出领域。

被判定为纠正的轮次通过现有的 `superseded:` 标签取代上一轮的 trace，以及模型在那一轮用 `remember` 保存的事实；实际验证表明，否则在被纠正轮次中记住的事实仍会保持有效。它不会获得 `outcome:correction` 标签，因此自动召回会保留它：它的摘要是在看到被回复消息的情况下写成的，写明了所指对象。由短语检测出的纠正保留该标签，仍不进入自动召回。

召回分节的标题为“About the user and people they mention”，`person` 领域涵盖用户陈述的关于自己或其认识的人的事实，记忆指引告诉模型每行都写明所指对象。

## Alternatives considered

**捕获后重写摘要。** Aeven 可以通过 `updateTrace` 替换 `trace.summary`，但 MemOS 不会重新计算 `vec_summary`，检索会继续匹配模型已看不到的、缺少主语的文本。

**为每条 `person` 记忆标注主体并分两组渲染。** 标题不再声称儿子的名字是关于用户的，但放在正确分组里的缺主语行仍会丢失所指，而且标签需要单独的分类输出和渲染路径。写明主体的摘要能同时解决两者。

**为纠正检测单独调用模型。** 它需要的正是摘要器已经发送的那次交流，单独调用会为一个布尔值把后台开销翻倍。

**提高 `person` 行数上限，或要求在归属名字前先调用 `memory_search`。** 两者都会给每个轮次增加 token 或工具调用，且存储的摘要仍然含糊。

## Consequences

经由 Host bridge 的捕获轮次只需一次模型调用而非两次，请求路径不变。摘要器提示有一部分位于依赖补丁中，升级 MemOS 时必须重新应用。只有被标注 trace 的摘要请求带有助手文本：MemOS 默认的 lightweight 捕获把整个轮次连同工具调用作为一个步骤摘要，完整捕获中的工具子步骤没有助手文本。识别依赖 MemOS 摘要提示的分段标签；标签变化时判定不再匹配，转而运行回退分类调用，而不会产生错误判定。本次修改之前存储的摘要在被取代前保留旧文本。`tests/turn-judge.spec.ts` 覆盖请求扩展、判定解析，以及依据判定进行的捕获归档与取代。
