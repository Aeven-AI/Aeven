# Agent Note: Delegation guidance says when to split a large task

Status: implemented

English | [中文](2026-11-09-delegation-split-guidance.zh.md)

## Problem

The `aeven` composition always offers `subagent` and `subagent_fork`, but nothing told the model when to use them for one large task. The tool description says to offload "focused, independent work", and the shared prompt section says only to start independent delegations together. A request such as fixing a whole failing test suite therefore ran serially in one context. Nothing warned against two children changing the same file in the shared workspace either.

## Decision

- **`splitGuidance` is a `tool-subagent` config field** ([`avn-tool-subagent`](../../../../packages/subagent/tool-subagent/README.md)). It is appended to the one shared `tool:<toolName>` section. Each visible continuable instance contributes its text once, and identical texts appear once. It requires `backgroundMode: continuable` with background runs enabled; a blank value or another mode fails at load.
- **Only agents that may delegate read it.** Each instance compares the prompting agent's delegation depth with its own budget, including the `subagent-nesting` switch, so a leaf child is not told to split work its delegation calls would be refused.
- **The `aeven` composition sets the wording on its `subagent` instance.** The text says when to split: independent parts that each take many steps, such as failures across several packages or test files. It asks the model to fix a shared cause first, give each subagent its own set of files, the command that reproduces its part, and a complete prompt, and to run the full check itself once before reporting. Small tasks and parts that change the same files stay with the parent.

## Alternatives considered

**Persona or master-prompt text** was rejected: the persona carries tone only, and delegation behavior belongs to the plugin that owns the tool. **A fixed sentence in code** was rejected because the wording is a deployment choice. **Allowing `workflow` without an explicit request** was deferred: plain parallel subagents cover splitting one task, and a workflow script is heavier for the model to write.

## Consequences

The parent prompt grows by the guidance text in the `aeven` composition. Flipping `subagent-nesting` changes a depth-1 agent's system prompt, and the change reaches the session log through the request system prompt. Whether the model now splits large tasks has no recorded-session coverage yet.
