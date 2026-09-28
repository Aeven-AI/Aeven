# Agent Note: Memory recall reliability

Status: implemented

## Problem

MemOS's relevance LLM filter can exhaust its internal two-second limit and then discard technically relevant candidates. Aeven's recalled block also reduces a trace to its summary, which can omit the command, setting, or tool result that made an earlier technique useful.

## Decision

The MemOS provider requests unfiltered candidates for turn-start recall through MemOS's defer-filter hint. MemOS lightweight mode forces its LLM filter on even when `retrieval.llmFilterEnabled` is false, so changing that configuration alone does not work. MemOS still supplies candidates, while Aeven orders them by query-term overlap and provider score, drops duplicate snippets, and applies configurable item limits for each domain. Technical trace snippets include stored tool inputs, outputs, and the assistant answer alongside the summary and captured outcome. The `world` classifier requires a reusable operation or fact and excludes discussion about designing Aeven.

## Consequences

Turn-start recall no longer waits on the two-second relevance call or its one-hit failure cutoff. Tool-driven searches still use MemOS's own filter. Larger technical snippets can consume more of the existing `contextMaxChars` budget; per-domain limits bound their count. The candidate set still comes from MemOS retrieval and can omit an item before Aeven orders it. Raw tool output in recalled text remains untrusted historical data.
