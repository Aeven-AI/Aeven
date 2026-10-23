# Agent Note：Claude Code 提供方不再继承启动方的会话身份

Status: implemented

[English](2026-08-29-claude-code-child-session-identity.md) | 中文

## Problem

`claudeQueryOptions` 以 `{ ...scrubbedParentEnv(), ...spec.env }` 组装子进程环境。该清理会移除具有凭证特征的变量；它不会移除 Claude Code 进程用以声明自身身份的那些变量。

官方 SDK 对其中两个变量仅在缺失时才赋值：

```js
if (!env.CLAUDE_CODE_ENTRYPOINT) env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
if (!env.CLAUDE_AGENT_SDK_VERSION) env.CLAUDE_AGENT_SDK_VERSION = '0.3.241'
```

因此被继承的值会压过 SDK 自己的答案，而 SDK 所派生的 CLI 会被告知它属于另一个并非本次的会话。从 Claude Code 内部启动的 Host 会向下传递 `CLAUDE_CODE_ENTRYPOINT=claude-vscode`，以及该会话所带的 `CLAUDE_AGENT_SDK_VERSION` —— 在此处是 `0.3.251`，而固定版本为 `0.3.241`。子进程遂以 VS Code 宿主会话的身份作答并以 1 退出，每次运行都以 `stage: query-run; category: invalid-result` 失败。

这不是仅存在于测试中的条件。任何 Host 由 Claude Code 会话启动的部署都会遇到它，而失败信息没有任何一处指向环境。

`packages/subagent/subagent-claude-code/tests/real-product.e2e.ts` —— 真实产品端到端套件 —— 的 8 个测试全部因此失败，而仅从环境中移除 `CLAUDE_CODE_ENTRYPOINT` 便全部通过。该文件本就针对同一类泄漏隔离了 `ANTHROPIC_MODEL` 与 `ANTHROPIC_SMALL_FAST_MODEL`。

## Decision

**提供方在显式 `env` 覆盖之前，于 `withoutParentSession` 中从继承环境里丢弃 `CLAUDE_CODE_ENTRYPOINT` 与 `CLAUDE_AGENT_SDK_VERSION`。** SDK 随后为两者赋值，于是子进程被标识为 SDK 实际启动的那次运行。

**覆盖仍然优先。** 有理由指定子进程启动方的部署可通过 `env` 配置字段设置二者，该覆盖在丢弃之后叠加。提供方移除的是被继承的意外，而非既定的选择。

**该集合恰为 SDK 条件性赋默认值的那两个**，而非全部 `CLAUDE_*` 环境名。这两者具有明确的 SDK contract，被继承的值会静默地压过它 —— 这正是继承它们为错的原因。`CLAUDECODE`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID` 等均经实测，在此不产生任何影响；移除它们属于臆测。

## Testing

`real-product.e2e.ts` 在保留 Claude Code 环境变量（即此前失败的条件）下 8 个测试全绿。`subagent-claude-code.spec.ts` 中的单元测试打桩这两个变量，断言二者均未进入组装后的 options，并断言显式 `env` 条目依然生效。该包保持按文件 100% 覆盖率。

## Alternatives considered

**在 spec 中与 `ANTHROPIC_MODEL` 一并删除这些变量。** 否决：该文件本就因环境模型变量会破坏运行而隔离它们，本例的破坏方式完全相同 —— 但 spec 并非唯一调用方。任何由 Claude Code 会话启动的 Host 在生产中都会遇到它，而只写在测试里的修复，会把一个信息中毫无可操作线索的失败留给那位用户。

**清除全部 `CLAUDE_*` 与 `CLAUDECODE` 环境名。** 否决：`CLAUDECODE`、`CLAUDE_CODE_CHILD_SESSION`、`CLAUDE_PID`、`CLAUDE_EFFORT` 与 `AI_AGENT` 均已针对失败套件逐个单独移除测试，均无任何影响。清除它们等于声明一条证据并不支持的规则，并会静默扣留某个部署可能有意传递的环境。

## Consequences

提供方现在会声明它所启动子进程的身份，而不再转发启动 Host 的那一方。促成本次改动的诊断信息 —— `invalid-result`、退出码 1 且无更多事实 —— 保持原样；它所报告的条件被消除，而非被描述得更清楚。

其余变量的环境继承仍为默认行为，因此依赖环境配置传递到子进程的部署不受影响。
