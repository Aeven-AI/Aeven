# Agent Note: Delegation guidance says when to split a large task

Status: implemented

English | [中文](2026-11-09-delegation-split-guidance.zh.md)

## Problem

The `aeven` composition always offers `subagent` and `subagent_fork`, but nothing told the model when to use them for one large task. The tool description says to offload "focused, independent work", and the shared prompt section says only to start independent delegations together. A request such as fixing a whole failing test suite therefore ran serially in one context. Nothing warned against two children changing the same file in the shared workspace either.

## Decision

- **`splitGuidance` is a `tool-subagent` config field** ([`avn-tool-subagent`](../../../../packages/subagent/tool-subagent/README.md)). It is appended to the one shared `tool:<toolName>` section. Each visible continuable instance contributes its text once, and identical texts appear once. It requires `backgroundMode: continuable` with background runs enabled; a blank value or another mode fails at load.
- **Only agents that may delegate read it.** Each instance compares the prompting agent's delegation depth with its own budget, including the `subagent-nesting` switch, so a leaf child is not told to split work its delegation calls would be refused.
- **The `aeven` composition sets the wording on its `subagent` instance.** The text says when to split: independent parts that each take many steps, such as separate research questions, options to compare, sources to gather from, or failures across several packages or test files. It asks the model to fix a shared cause first, give each subagent its own set of files, the command that reproduces its part, what to return, and a complete prompt, and to check and combine the results and run the full check itself once before reporting. Small tasks and parts that change the same files stay with the parent.
- **The split decision comes before the work.** When the request already names the parts, the model starts the subagents right away; when it does not, the model surveys only enough to find the parts and then starts them. It does not finish one part itself before splitting the rest, because by then the parent's context holds exploration that every child repeats and the parts no longer run in parallel. The survey step exists because a `subagent` child sees only its prompt, so a split started before the parent knows the parts produces vague prompts.

## Alternatives considered

**Persona or master-prompt text** was rejected: the persona carries tone only, and delegation behavior belongs to the plugin that owns the tool. **A fixed sentence in code** was rejected because the wording is a deployment choice. **Allowing `workflow` without an explicit request** was deferred: plain parallel subagents cover splitting one task, and a workflow script is heavier for the model to write.

## Consequences

The parent prompt grows by the guidance text in the `aeven` composition. Flipping `subagent-nesting` changes a depth-1 agent's system prompt, and the change reaches the session log through the request system prompt. Whether the model now splits large tasks has no recorded-session coverage yet.
