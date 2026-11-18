# Agent Note: recall without a relevance judgment by default

Status: implemented

English | [中文](2026-11-18-recall-without-a-relevance-judgment.zh.md)

## Problem

Every turn-start recall ran a relevance judgment: one model call, about 1.1 s at the median on DeepSeek Flash whatever its input size, between retrieval and the answer. On the hosted Host 30 of 96 judged recalls finished after memory-context's 5 s budget and were discarded. The judgment is also unstable: run twice on the same 15 recorded turns it kept the same memory in 104 of 130 cases.

## Decision

- Each account's `memory-recall` settings section holds `judge`, off by default; Settings → General shows it as a switch after the Composer's Enter row, and its question icon states that turning it on starts every answer about a second later.
- With it off, `@aeven/memory-memos` returns every candidate, learned procedures included, marked `unjudged`. memory-context renders them with `unjudgedMaxItems` (60) and `unjudgedMaxChars` (16,000), opening the block with a line saying they are unchecked candidates to use only when they bear on the message.
- A later turn receives no recent memories without a judgment, because only the judgment can call a turn personal.

## Evidence

On 47 recorded turns of the owner's account, answered once with the judged memory and once with every candidate and graded blind by DeepSeek: every-candidate answers were better 23 times, judged answers 14 times, equal 10 times; they missed a relevant memory 4 times against 7 and used an irrelevant one 3 times against 7. They carried about 2,300 memory tokens against 480, while the judgment's two calls read about 6,900. The opening line lowered irrelevant use from 3 to 2 and misses from 4 to 3 on 24 of those turns. Judged answers stay better on very short messages such as greetings.

## Alternatives considered

- **Skip the judgment only when candidates are few.** Rejected: all 15 sampled turns had 30–67 candidates.
- **A faster judging model.** Not available: the judgment already runs on Flash, and DeepSeek's latency floor is about a second per call.

## Consequences

Learned procedures delivered unjudged are no longer promoted by a judgment's selection. The grading used single-message replays without conversation history and short tool-less answers; it measures use of memory, not task quality.
