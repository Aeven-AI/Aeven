# Agent Note: 显式记忆搜索返回捕获到的原始消息

Status: implemented

[English](2026-10-01-recall-returns-the-captured-message.md) | 中文

## Problem

`traceSnippet`——显式搜索对单条轨迹展示的内容——返回提炼后的摘要、工具记录和助手回答，但从不返回 `trace.userText`：捕获存储的消息，摘要正是由它提炼而来。`hitOrigin` 随后在显式搜索时对 `person` 记忆也只选择摘要，于是最常被引用的那一类记忆反而返回了最难核实的文本。

因此两条召回路径都由提炼结果作答，而提炼会丢失内容。记忆基准测量到的情形：一个 `temporal` 探针为教学会话中讲过的发布顺序搜索记忆三次（`release versions shipped order timeline aurora`、`aurora-u30eu8 release shipped after`，以及一次更宽泛的查询）。每次结果都返回同一条摘要——它写明了渠道、代号和区域，却没有顺序——于是该探针选择弃答。顺序始终存在于该轨迹的 `user_text` 中，只差一次该探针从未发起的 `memory_get`；`recall-detail.spec.ts` 在单元层记录了同一情形。

这是该套件唯一的失败：记忆组 20/21，对照组 3/21，其中 `temporal` 为 2/3。

## Decision

显式搜索返回整条轨迹：先是已存储的摘要，然后是捕获到的原始消息，再是已存储的工具输入、输出和助手回答。自动召回仍只陈述摘要，因为它被注入到每一轮，而消息本身没有逐条上限（[理由](../feature/2026-10-01-memory-summary-recall.zh.md)）。`person` 例外被移除：显式搜索对所有领域都返回捕获到的消息。

`packages/memory/memory-memos/tests/recall-detail.spec.ts` 固定了四个事实：显式搜索返回捕获到的消息、对 `person` 记忆同样如此、它为消息加上标签以便读者将其与上方摘要区分，以及自动召回仍只陈述摘要。召回规范共用的伪 MemOS core 移至 `tests/harness.ts`，`userText` 正是在那里成为夹具的一部分。

## Alternatives considered

- **让摘要器更忠实。** 提炼属于被钉住版本的 MemOS core，按构造即有损；存储保留了消息，因此修复应当放在损失暴露之处，而不是放在一段我们不拥有的提示词里。
- **把捕获到的消息放进自动召回。** 它每轮都被注入，而消息的长度没有上限，摘要则有；当拿到的摘要不足以支撑时，代理去查的是搜索。
- **让搜索结果指向 `memory_get`。** 召回块已经写着“Use memory_get with an id to read a memory in full”，而被测量的探针读了该块三次却没有使用它。再重复一次提示并不会把事实变得可及。

## Consequences

一条搜索结果携带更多文本，其上限由 `tool-memory` 的 `resultMaxChars`（默认 1200）决定，而不是由摘要自身的长度决定。自动召回的内容与开销不变，因此每轮都走的那条路径没有为这次修复付出代价。

摘要丢弃的事实现在可以在找到该记忆的同一个调用中取回，无需代理自己决定再发起一次查询。摘要保留其角色：它是召回用于排序和注入的内容，而不是一次刻意查询所能看到的上限。

## Verification

`pnpm exec vitest run packages/memory/memory-memos` 通过 3 个文件共 13 个测试，包含四个新用例；`npx tsc -p tsconfig.host.json --noEmit` 退出码为 0。`pnpm run benchmark:memory --abilities temporal,prior-session --runs 3` 重跑本次改动涉及的各项能力。
