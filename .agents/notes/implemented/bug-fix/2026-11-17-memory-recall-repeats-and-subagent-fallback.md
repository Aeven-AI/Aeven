# Agent Note: Recall Skips Repeats and Unjudged Subagent Memories

Status: implemented

English | [中文](2026-11-17-memory-recall-repeats-and-subagent-fallback.zh.md)

## Problem

`memory-context` appends one recall block to every user turn and keeps each block in the session's history, but it rendered every block without regard to what earlier blocks delivered. In the six largest recent local sessions about half of all recalled lines repeated a memory already in history; the largest carried 92 blocks and 210,570 characters for 120 distinct memories.

A subagent's task prompt is a `user` message and the child inherits the parent's owner, so children recall too. When the relevance judgment failed or ran out of time, the provider's mechanical fallback delivered its two top-ranked memories; across 87 recent child sessions about 30 research children each received two unrelated memories about the person (birth date, family, accounts).

## Decision

- **A memory an earlier block of the session delivered is left out of later blocks.** `deliveredMemoryIds` reads the ids from the session's earlier `memory-context` recall blocks; blocks before the latest `compaction/summary` or `compaction/prune` do not count, so a memory compaction removed can be delivered again. A turn whose recall found only repeats carries a notice that the memories given earlier still apply, and a personal turn still receives the personal note when its memories about the person came from an earlier block.
- **A subagent session receives nothing from a degraded recall.** Its turn carries a notice that recall could not judge which memories fit the task. Judged recall and the profile block stay, because the logs showed judged personal lines helping children whose task was about the person, and the profile block caused no observed leak.

## Alternatives considered

**Drop person-domain memories and the profile block for every subagent.** Children that mine the person's own archive for a profile received relevant personal lines from a working judgment; removing them loses context the task needs.

**Repeat delivered memories as id references only.** The full line is already in the request's history, so a reference adds tokens without adding information.

## Consequences

Long sessions stop accumulating duplicate memory lines, and the recall block of a later turn holds only memories the session has not seen. Main sessions keep the two-memory fallback when the judgment fails.
