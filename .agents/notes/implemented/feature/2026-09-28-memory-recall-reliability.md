# Agent Note: Memory recall reliability

Status: implemented

## Problem

MemOS's relevance LLM filter can exhaust its internal two-second limit and then discard technically relevant candidates. Aeven's recalled block also reduces a trace to its summary, which can omit the command, setting, or tool result that made an earlier technique useful.

## Decision

The MemOS provider requests unfiltered candidates for automatic and explicit recall through MemOS's turn-start defer-filter hint. MemOS lightweight mode forces its LLM filter on even when `retrieval.llmFilterEnabled` is false, so changing that configuration alone does not work. Explicit search retains the provider's configured per-tier limits unless the caller supplies limits. MemOS still supplies candidates, while Aeven orders automatic recall by query-term overlap in the stored summary before the longer tool record and assistant answer, prefers outcome evidence when the query asks for it, drops duplicate snippets, and applies configurable item limits for each domain. Correction-tagged traces stay searchable as history but are omitted from automatic recall because their referent is not recorded. Technical trace snippets include stored tool inputs, outputs, and the assistant answer alongside the summary and captured outcome. The `world` classifier requires a reusable operation or fact and excludes discussion about designing Aeven.

## Consequences

Recall no longer waits on the two-second relevance call or its one-hit failure cutoff. MemOS records explicit searches under its turn-start retrieval reason because that is the path that accepts the defer-filter hint. The one-item default is 1,000 characters so a stored command and its short output can appear beside the outcome label; per-domain limits and `contextMaxChars` bound the whole block. A new-session browser check recalled the exact Node version command and stdout with the `Assistant reported verification` label, and an explicit `memory_search` logged `DEFERRED_TO_FINAL`. The candidate set still comes from MemOS retrieval and can omit an item before Aeven orders it. Raw tool output in recalled text remains untrusted historical data.
