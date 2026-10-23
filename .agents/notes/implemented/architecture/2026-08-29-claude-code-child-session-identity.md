# Agent Note: The Claude Code provider does not inherit its launcher's session identity

Status: implemented

English | [中文](2026-08-29-claude-code-child-session-identity.zh.md)

## Problem

`claudeQueryOptions` composed the child environment as `{ ...scrubbedParentEnv(), ...spec.env }`. The scrub removes credential-shaped variables; it does not remove the variables by which a Claude Code process announces itself.

The official SDK assigns two of those only when they are absent:

```js
if (!env.CLAUDE_CODE_ENTRYPOINT) env.CLAUDE_CODE_ENTRYPOINT = 'sdk-ts'
if (!env.CLAUDE_AGENT_SDK_VERSION) env.CLAUDE_AGENT_SDK_VERSION = '0.3.241'
```

An inherited value therefore wins over the SDK's own answer, and the CLI the SDK spawns is told it belongs to a session that is not this one. A Host started from inside Claude Code hands down `CLAUDE_CODE_ENTRYPOINT=claude-vscode` and whatever `CLAUDE_AGENT_SDK_VERSION` that session carries — `0.3.251` against the pinned `0.3.241` here. The child answers as a VS Code-hosted session and exits 1, and every run fails as `stage: query-run; category: invalid-result`.

This is not a test-only condition. Any deployment whose Host is launched from a Claude Code session reaches it, and the failure names nothing that points at the environment.

`packages/subagent/subagent-claude-code/tests/real-product.e2e.ts` — the real-product end-to-end suite — failed all 8 of its tests for exactly this reason and passed with `CLAUDE_CODE_ENTRYPOINT` alone removed from the ambient environment. The file already isolates `ANTHROPIC_MODEL` and `ANTHROPIC_SMALL_FAST_MODEL` against the same class of leak.

## Decision

**The provider drops `CLAUDE_CODE_ENTRYPOINT` and `CLAUDE_AGENT_SDK_VERSION` from the inherited environment**, in `withoutParentSession`, before the explicit `env` overlay. The SDK then assigns both, so the child is identified as the run the SDK is actually starting.

**The overlay still wins.** A deployment that has a reason to name the child's launcher sets either through the `env` config field, which is layered after the drop. The provider removes an inherited accident, not a stated choice.

**The set is exactly the two the SDK conditionally defaults**, not every ambient `CLAUDE_*` name. Those two have a stated SDK contract that an inherited value silently overrides, which is what makes inheriting them wrong. `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_PID`, and the rest were measured and change nothing here; removing them would be speculation.

## Testing

`real-product.e2e.ts` runs 8 green with the ambient Claude Code environment present, which is the condition that failed. A unit test in `subagent-claude-code.spec.ts` stubs both variables, asserts neither reaches the composed options, and asserts an explicit `env` entry still does. The package holds per-file 100% coverage.

## Alternatives considered

**Delete the variables in the spec, beside `ANTHROPIC_MODEL`.** Rejected: the file already isolates ambient model env because it corrupts the run, and this corrupts it the same way — but the spec is not the only caller. Any Host launched from a Claude Code session hits it in production, and a fix that only the test carries leaves that user with a failure whose message names nothing they can act on.

**Scrub every ambient `CLAUDE_*` and `CLAUDECODE` name.** Rejected: `CLAUDECODE`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_PID`, `CLAUDE_EFFORT`, and `AI_AGENT` were each removed on their own against the failing suite and changed nothing. Scrubbing them would state a rule the evidence does not support, and would silently withhold environment a deployment may be passing on purpose.

## Consequences

The provider now states the identity of the child it starts instead of forwarding whatever started the Host. The diagnostic that motivated this — `invalid-result` with exit code 1 and no further facts — stays as it is; the condition it reported is gone rather than better described.

Environment inheritance remains the default for everything else, so a deployment that relies on ambient configuration reaching the child is unaffected.
