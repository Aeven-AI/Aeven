# Agent Note: Trace summaries for automatic recall

Status: implemented

English | [中文](2026-10-01-memory-summary-recall.zh.md)

## Problem

Copied assistant answers and tool records consume automatic recall space. A remembered preference or lesson becomes harder to identify among historical detail.

## Decision

The MemOS provider uses the stored trace summary for `turn-start` recall in every trace domain. Outcome labels already stored in the summary remain visible. Explicit searches return the expanded trace for every domain, including the captured message a summary was distilled from ([detail](../bug-fix/2026-10-01-recall-returns-the-captured-message.md)), and trace reads retain the stored detail. Missing summaries retain the candidate snippet; non-trace candidates keep their existing representation. No new summarizer, storage format, limit, or tool restriction is introduced.

This partially supersedes the automatic artifact delivery in the [memory roadmap](../../proposed/feature/2026-09-28-long-term-memory-roadmap.md), whose other decisions remain active. The [provider foundation](2026-09-28-long-term-memory-memos.md) retains its independent scope. The recalled block is delivered once per turn: appending it again before each later request was rejected, and no measurement compared the two.

## Alternatives considered

- Expanded automatic snippets preserve immediate detail but repeat historical answers in every recalled block.
- Appending the block before each later request keeps the text beside the action, at one more copy per request that grows with the number of steps, and no measurement shows it changes what the agent does.
- A new generated lesson requires another model call and durable representation; existing summaries supply the smallest change.

## Consequences

Automatic trace recall emphasizes the remembered summary while technical detail requires explicit retrieval. Existing tool output limits can clip that detail; this change does not provide pagination. Stored summaries can omit useful facts, and clearer delivery does not guarantee compliance.

## Verification

TypeScript and the full build pass. Live Chrome testing against the rebuilt server covers two completed turns, each carrying one recalled block. Two matching trace lines measure 148 and 166 characters against 1,015 and 1,024 in an earlier trajectory. Automatic blocks contain summaries and outcome labels without appended assistant answers or tool records. The agent identifies the explanation-only preference and performs two requested reads. `memory_get` returns the original answer heading and excerpt, clipped by its existing output limit. These observations establish delivery and observed preference use, without proving a total token saving or universal compliance. No automated behavioral suites run.
