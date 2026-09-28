# Agent Note: Memory outcome capture

Status: implemented

## Problem

A captured turn contains the conversation and tool results, but the memory provider cannot distinguish a recoverable model retry, a user correction, a reported verification, or a completed goal from ordinary prose. Treating a successful tool call or a retry as the task outcome would teach the wrong lesson.

## Decision

`memory-context` derives outcome evidence from committed events in the same turn, extending the turn capture established in [long-term memory with a MemOS provider](2026-09-28-long-term-memory-memos.md). It records failure codes from `llm/retry`, an explicit direct-user correction cue, an assistant verification statement only when the turn has a successful completed tool call, and the objective from a `goal/change` completion. The verification statement remains an assistant report, not a claim that an external condition passed. Tool calls and their actual results remain the evidence behind it.

`memory-memos` stores this evidence in MemOS trace context hints, adds searchable `outcome:` tags, and appends the evidence to the trace summary that recall returns. A durably completed goal gives that trace positive implicit feedback. Retries and failed tool calls receive no automatic negative feedback because the turn can still succeed. Explicit message ratings retain their own feedback path.

## Alternatives considered

Inferring task success from `turn/end`, a successful tool result, or a model assertion alone would conflate completed execution with verified work. Treating every corrective-looking utterance as feedback on the immediately preceding trace would also misattribute corrections that refer to older work or another session. The current capture keeps correction text on its own turn.

## Consequences

The correction cues recognize explicit English and Chinese openings; other phrasing remains ordinary captured text. Verification outside a recorded successful tool call is not tagged. The evidence appears with a trace selected for recall, while step 6 retains responsibility for choosing which traces enter recalled context.
